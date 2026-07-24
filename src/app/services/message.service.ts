import { Injectable, effect, inject, signal, isDevMode } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap, from } from 'rxjs';
import { Router } from '@angular/router';
import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  runTransaction,
  arrayUnion,
  serverTimestamp,
  getDoc,
  increment
} from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { Auth } from '../core/auth';
import { ConversationService } from './conversation.service';
import { UserService } from './user.service';
import { CryptoService } from './crypto.service';
import { Message } from '../models/message.model';
import { Conversation } from '../models/conversation.model';

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly auth = inject(Auth);
  private readonly conversationService = inject(ConversationService);
  private readonly userService = inject(UserService);
  private readonly cryptoService = inject(CryptoService);
  private readonly router = inject(Router);

  readonly activeMessages = signal<Message[]>([]);
  private readonly rawMessages = signal<Message[]>([]);

  private messagesUnsubscribe?: () => void;
  private readonly lastNotifiedTimestamps = new Map<string, number>();

  constructor() {
    // Depend on the primitive ID, not the derived object, to avoid listener churn
    // on every conversation list update (reactions, unread resets, lastMessage writes etc.)
    effect(() => {
      const convo = this.conversationService.selectedConversation();
      const user = this.auth.currentUser();
      const convoId = convo?.id;
      const clearedAt = convo?.clearedAt?.[user?.uid || ''] || 0;

      if (convoId) {
        this.subscribeToMessages(convoId, clearedAt);
      } else {
        this.unsubscribe();
        this.rawMessages.set([]);
        this.activeMessages.set([]);
      }
    });

    // Reactive decryption pipeline using toObservable + switchMap to avoid race conditions
    toObservable(this.rawMessages)
      .pipe(
        switchMap((rawList) => from(this.decryptMessagesList(rawList)))
      )
      .subscribe((decryptedList) => {
        this.activeMessages.set(decryptedList);
      });

    // Reactive notification listener for all user conversations (Option 1: In-Browser Push)
    effect(() => {
      const convos = this.conversationService.conversations();
      const user = this.auth.currentUser();
      if (!user?.uid) {
        this.lastNotifiedTimestamps.clear();
        return;
      }

      const activeConvoId = this.conversationService.selectedConversationId();

      convos.forEach((convo) => {
        const lastSeenTime = this.lastNotifiedTimestamps.get(convo.id);
        const isNewMessage = lastSeenTime !== undefined && convo.lastMessageAt > lastSeenTime;

        if (isNewMessage) {
          const isFocusedInChat = convo.id === activeConvoId && !document.hidden;
          const isSystem = convo.lastMessageIsSystem;
          const unread = convo.unreadCount?.[user.uid] || 0;
          const hasUnread = unread > 0;

          if (isDevMode()) {
            console.info(`[Notification Evaluation] Convo: ${convo.id}`, {
              isNewMessage,
              activeConvoId,
              convoId: convo.id,
              documentHidden: document.hidden,
              isFocusedInChat,
              isSystem,
              unreadCount: unread,
              hasUnread,
              willNotify: !isFocusedInChat && hasUnread
            });
          }

          if (!isFocusedInChat && hasUnread) {
            this.handleConvoNotification(convo);
          }
        }

        this.lastNotifiedTimestamps.set(convo.id, convo.lastMessageAt);
      });
    });
  }

  private async decryptMessagesList(rawList: Message[]): Promise<Message[]> {
    const convoId = this.conversationService.selectedConversationId();
    const isReady = this.cryptoService.isPrivateKeyReady();

    if (!convoId) return [];
    if (!isReady) return rawList;

    try {
      const aesKey = await this.cryptoService.getOrDecryptConversationKey(convoId);
      if (!aesKey) return rawList;

      return await Promise.all(
        rawList.map(async (msg) => {
          if (msg.text && msg.encryptionVersion === 2) {
            try {
              const decrypted = await this.cryptoService.decryptText(msg.text, aesKey);
              return { ...msg, text: decrypted };
            } catch (e) {
              console.warn('Failed to decrypt message:', msg.id, e);
              return { ...msg, text: '[Decryption Error]' };
            }
          }
          return msg;
        })
      );
    } catch (err) {
      console.error('Error during message decryption stream:', err);
      return rawList;
    }
  }

  private subscribeToMessages(convoId: string, clearedAt: number) {
    this.unsubscribe();

    // Use createdAtMs (real client timestamp) for ordering — avoids reorder flicker
    // from serverTimestamp() being null/pending in Firestore's local cache.
    const q = query(
      collection(db, 'conversations', convoId, 'messages'),
      orderBy('createdAtMs', 'asc')
    );

    this.messagesUnsubscribe = onSnapshot(q, (snapshot) => {
      const user = this.auth.currentUser();

      const list: Message[] = snapshot.docs
        .map(d => {
          const msg = { id: d.id, ...d.data() } as Message;
          let createdAt = msg.createdAtMs;
          if (createdAt === undefined || createdAt === null) {
            if (typeof msg.createdAt === 'number') {
              createdAt = msg.createdAt;
            } else if (msg.createdAt && typeof msg.createdAt.toMillis === 'function') {
              createdAt = msg.createdAt.toMillis();
            } else if (msg.createdAt && typeof msg.createdAt === 'object' && msg.createdAt.seconds !== undefined) {
              createdAt = msg.createdAt.seconds * 1000 + Math.floor(msg.createdAt.nanoseconds / 1000000);
            } else {
              createdAt = Date.now();
            }
          }
          return { ...msg, createdAt };
        })
        .filter(msg => 
          !msg.deletedFor?.includes(user?.uid || '') &&
          (msg.createdAt || 0) >= clearedAt
        );

      this.rawMessages.set(list);
    });
  }

  private unsubscribe() {
    if (this.messagesUnsubscribe) {
      this.messagesUnsubscribe();
      this.messagesUnsubscribe = undefined;
    }
  }

  private async handleConvoNotification(convo: Conversation) {
    console.info('🔔 Triggering notification for conversation:', convo.id, 'Permission:', typeof Notification !== 'undefined' ? Notification.permission : 'unavailable');

    // 1. Play Web Audio synthetic ping sound if enabled
    const soundEnabled = localStorage.getItem('sound_effects') !== 'false';
    if (soundEnabled) {
      this.playSyntheticPing();
    }

    // 2. Trigger browser native notification if enabled
    const notificationsEnabled = localStorage.getItem('notifications') !== 'false';
    if (notificationsEnabled && typeof Notification !== 'undefined') {
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      if (permission === 'granted') {
      const currentUid = this.auth.currentUser()?.uid;
      let title = 'Loop';

      if (convo.type === 'dm') {
        const partnerUid = convo.participants.find((p) => p !== currentUid);
        if (partnerUid) {
          const partner = this.userService.usersCache()[partnerUid];
          title = partner?.displayName || partner?.username || 'Someone';
        }
      } else if (convo.type === 'group') {
        title = convo.groupName || 'Group Chat';
      }

      try {
        let bodyText = convo.lastMessage;

        // Decrypt E2EE notification preview text
        const isSystemMessage =
          convo.lastMessageIsSystem ||
          convo.lastMessage === 'Conversation started' ||
          convo.lastMessage === 'Group created' ||
          convo.lastMessage === 'Message deleted' ||
          convo.lastMessage === 'Group deleted by admin' ||
          convo.lastMessage.includes(' added ') ||
          convo.lastMessage.includes(' removed ') ||
          convo.lastMessage.endsWith(' left the group');

        if (convo.lastMessage && convo.lastMessageEncryptionVersion === 2 && !isSystemMessage) {
          try {
            const aesKey = await this.cryptoService.getOrDecryptConversationKey(convo.id);
            if (aesKey) {
              bodyText = await this.cryptoService.decryptText(convo.lastMessage, aesKey);
            } else {
              bodyText = '[Encrypted Message]';
            }
          } catch (decryptErr) {
            // Fallback gracefully if ciphertext is invalid or legacy plaintext was stored
            bodyText = convo.lastMessage;
          }
        }

        const notif = new Notification(title, {
          body: bodyText,
          tag: convo.id,
        });

        notif.onclick = (event) => {
          event.preventDefault();
          window.focus();
          this.conversationService.selectConversation(convo.id);
          this.router.navigate(['/chats', convo.id]);
        };
      } catch (e) {
        console.warn('Native notification trigger failed:', e);
      }
    }
  }
}

  private audioCtx: AudioContext | null = null;

  private playSyntheticPing() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // pop chime sweep
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08); // A5

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } catch (e) {
      console.warn('Web Audio synthesis failed:', e);
    }
  }

  async sendMessage(text: string, replyTo?: string, mentions?: string[]): Promise<void> {
    const convo = this.conversationService.selectedConversation();
    const user = this.auth.currentUser();
    if (!convo || !user) throw new Error('No selected conversation or user');

    const convoId = convo.id;
    let aesKey: CryptoKey | null = null;
    const hasKeys = convo.lastMessageEncryptionVersion === 2;

    if (!hasKeys) {
      // Transactional E2EE upgrade for legacy chats
      try {
        // Pre-compute crypto outside transaction — RSA operations risk timing out inside the transaction window
        const publicKeys = await Promise.all(
          convo.participants.map(async (pId) => {
            const userSnap = await getDoc(doc(db, 'users', pId));
            if (!userSnap.exists()) throw new Error('User profile not found');
            const uData = userSnap.data();
            if (!uData['publicKey']) {
              const name = uData['displayName'] || uData['username'] || 'User';
              throw new Error(`E2EE_UPGRADE_REQUIRED:${name}`);
            }
            return { uid: pId, pk: uData['publicKey'] };
          })
        );

        const newAesKey = await this.cryptoService.generateGroupKey();
        const encryptedKeys = await Promise.all(
          publicKeys.map(async ({ uid, pk }) => ({
            uid,
            encryptedKey: await this.cryptoService.encryptGroupKey(newAesKey, pk),
          }))
        );

        aesKey = await runTransaction(db, async (transaction) => {
          const convoRef = doc(db, 'conversations', convoId);
          const convoSnap = await transaction.get(convoRef);
          if (!convoSnap.exists()) {
            throw new Error('Conversation document not found');
          }

          const convoData = convoSnap.data();
          const version = convoData['lastMessageEncryptionVersion'] || 0;

          // If another transaction upgraded it concurrently, abort and let outer logic load it
          if (version === 2) {
            return null;
          }

          // Write pre-computed envelopes synchronously
          for (const { uid, encryptedKey } of encryptedKeys) {
            const envelopeRef = doc(db, 'conversations', convoId, 'keys', uid);
            transaction.set(envelopeRef, { encryptedKey });
          }

          // Update conversation metadata
          transaction.update(convoRef, { lastMessageEncryptionVersion: 2 });

          return newAesKey;
        });

        if (aesKey === null) {
          // Load the key generated by the other writer
          aesKey = await this.cryptoService.getOrDecryptConversationKey(convoId);
        } else {
          // Cache the key
          this.cryptoService.setGroupKey(convoId, aesKey);
        }
      } catch (e: any) {
        console.error('E2EE upgrade failed:', e);
        if (e.message?.startsWith('E2EE_UPGRADE_REQUIRED:')) {
          const name = e.message.split(':')[1];
          throw new Error(`Cannot encrypt chat: ${name} needs to update their application to support encryption first.`);
        }
        throw e;
      }
    } else {
      // Normal E2EE envelope decryption
      aesKey = await this.cryptoService.getOrDecryptConversationKey(convoId);
    }

    if (!aesKey) {
      if (!this.cryptoService.getLoadedPrivateKey()) {
        throw new Error('Encryption key not loaded. Please unlock your account passphrase to send encrypted messages.');
      }

      console.warn(`Key envelope missing for conversation ${convoId}. Running self-healing E2EE key distribution...`);
      try {
        aesKey = await this.selfHealGroupKeys(convoId, convo.participants);
      } catch (err: any) {
        console.error('Self-healing E2EE key distribution failed:', err);
        throw new Error(err.message || 'Failed to resolve encryption key for this conversation.');
      }
    }

    // Encrypt message text
    const encryptedText = await this.cryptoService.encryptText(text.trim(), aesKey);
    const now = Date.now();

    const messageData = {
      senderId: user.uid,
      text: encryptedText,
      createdAt: serverTimestamp(),
      createdAtMs: now,
      reactions: {},
      replyTo: replyTo || null,
      mentions: mentions || [],
      encryptionVersion: 2,
    };

    const messagesRef = collection(db, 'conversations', convoId, 'messages');
    await addDoc(messagesRef, messageData);

    // Update conversation metadata
    const convoRef = doc(db, 'conversations', convoId);
    const updates: Record<string, any> = {
      lastMessage: encryptedText,
      lastMessageAt: now,
      lastMessageEncryptionVersion: 2,
      lastMessageIsSystem: false,
    };

    convo.participants.forEach((pId: string) => {
      if (pId !== user.uid) {
        updates[`unreadCount.${pId}`] = increment(1);
      }
    });

    await updateDoc(convoRef, updates);
  }

  async toggleReaction(messageId: string, emoji: string): Promise<void> {    
    const convo = this.conversationService.selectedConversation();
    const user = this.auth.currentUser();
    
    if (!convo || !user) {
      console.warn('Convo or user not resolved in toggleReaction. convo:', convo, 'user:', user);
      return;
    }

    const messageRef = doc(db, 'conversations', convo.id, 'messages', messageId);

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(messageRef);
        if (!snap.exists()) {
          console.warn('Message document not found during reaction transaction');
          return;
        }

        const data = snap.data() as Message;
        const reactions = { ...(data.reactions || {}) };
        const currentList = reactions[emoji] ? [...reactions[emoji]] : [];

        if (currentList.includes(user.uid)) {
          reactions[emoji] = currentList.filter((id) => id !== user.uid);
        } else {
          reactions[emoji] = [...currentList, user.uid];
        }

        if (reactions[emoji].length === 0) {
          delete reactions[emoji];
        }

        transaction.update(messageRef, { reactions });
      });
    } catch (err) {
      console.error('Reaction transaction failed:', err);
      throw err;
    }
  }

  // Delete individual message for current user (soft-delete)
  async deleteMessageForMe(messageId: string): Promise<void> {
    const convo = this.conversationService.selectedConversation();
    const user = this.auth.currentUser();
    if (!convo || !user) return;

    const messageRef = doc(db, 'conversations', convo.id, 'messages', messageId);
    await updateDoc(messageRef, {
      deletedFor: arrayUnion(user.uid)
    });
  }

  // Delete message for everyone (within 15 minutes window check)
  async deleteMessageForEveryone(messageId: string): Promise<void> {
    const convo = this.conversationService.selectedConversation();
    const user = this.auth.currentUser();
    if (!convo || !user) return;

    const messageRef = doc(db, 'conversations', convo.id, 'messages', messageId);
    await updateDoc(messageRef, {
      deletedForEveryone: true,
    });

    // Update conversation lastMessage preview if this was the latest message
    const messages = this.activeMessages();
    const isLast = messages[messages.length - 1]?.id === messageId;
    if (isLast) {
      const convoRef = doc(db, 'conversations', convo.id);
      await updateDoc(convoRef, {
        lastMessage: 'Message deleted',
      });
    }
  }

  // Self-heal E2EE key distribution transactionally if envelope subcollection is missing in Firestore
  private async selfHealGroupKeys(convoId: string, participants: string[]): Promise<CryptoKey> {
    // ── Phase 1: All async crypto BEFORE the transaction ─────────────────────
    // RSA-OAEP encrypt operations can take 10-50ms each on slow devices.
    // Running them inside the Firestore transaction window (typically ~5s)
    // risks a spurious timeout-abort on larger groups. Pre-compute everything
    // so the transaction only does reads + synchronous writes.
    const newAesKey = await this.cryptoService.generateGroupKey();

    const publicKeys = await Promise.all(
      participants.map(async (uid) => {
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (!userSnap.exists()) throw new Error('User profile not found');
        const uData = userSnap.data();
        if (!uData['publicKey']) {
          const name = uData['displayName'] || uData['username'] || 'User';
          throw new Error(`Cannot encrypt chat: ${name} needs to setup encryption first.`);
        }
        return { uid, pk: uData['publicKey'] };
      })
    );

    const encryptedKeys = await Promise.all(
      publicKeys.map(async ({ uid, pk }) => ({
        uid,
        encryptedKey: await this.cryptoService.encryptGroupKey(newAesKey, pk),
      }))
    );

    // ── Phase 2: Transaction does reads + writes only — no async crypto ───────
    try {
      const resultKey = await runTransaction(db, async (transaction) => {
        const currentUser = this.auth.currentUser();
        if (!currentUser) throw new Error('User not authenticated');

        const convoRef = doc(db, 'conversations', convoId);
        const convoSnap = await transaction.get(convoRef);

        // The only safe abort signal is whether MY envelope actually exists —
        // not the version flag. The version can be 2 while envelopes are missing
        // (e.g. data corruption, manual deletion, or a previous partial write).
        // Aborting on version alone would leave us unable to decrypt anything.
        const myEnvelopeRef = doc(db, 'conversations', convoId, 'keys', currentUser.uid);
        const myEnvelopeSnap = await transaction.get(myEnvelopeRef);
        if (myEnvelopeSnap.exists()) {
          return null; // Envelope exists and is readable — fetch it externally
        }

        // All reads done — now write synchronously (no async allowed after this)
        for (const { uid, encryptedKey } of encryptedKeys) {
          const envelopeRef = doc(db, 'conversations', convoId, 'keys', uid);
          transaction.set(envelopeRef, { encryptedKey });
        }

        // Update version only if it was not already 2 (avoids a no-op write on
        // the conversation doc when only some envelopes were missing)
        if ((convoSnap.data()?.['lastMessageEncryptionVersion'] ?? 0) !== 2) {
          transaction.update(convoRef, { lastMessageEncryptionVersion: 2 });
        }

        return newAesKey;
      });

      if (resultKey === null) {
        const existingKey = await this.cryptoService.getOrDecryptConversationKey(convoId);
        if (!existingKey) throw new Error('Failed to resolve self-healed E2EE key');
        return existingKey;
      }

      this.cryptoService.setGroupKey(convoId, resultKey);
      return resultKey;
    } catch (err: any) {
      console.error('Transactional self-heal failed:', err);
      throw err;
    }
  }
}
