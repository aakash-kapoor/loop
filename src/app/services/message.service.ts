import { Injectable, effect, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap, from } from 'rxjs';
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
  getDoc
} from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { Auth } from '../core/auth';
import { ConversationService } from './conversation.service';
import { UserService } from './user.service';
import { CryptoService } from './crypto.service';
import { Message } from '../models/message.model';

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly auth = inject(Auth);
  private readonly conversationService = inject(ConversationService);
  private readonly userService = inject(UserService);
  private readonly cryptoService = inject(CryptoService);

  readonly activeMessages = signal<Message[]>([]);
  private readonly rawMessages = signal<Message[]>([]);

  private messagesUnsubscribe?: () => void;

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

    let isFirstEmit = true;

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

      // Trigger alerts only on new incoming messages after the initial subscription fetch
      if (!isFirstEmit) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const newMsg = { id: change.doc.id, ...change.doc.data() } as Message;
            const currentUid = this.auth.currentUser()?.uid;
            const activeConvoId = this.conversationService.selectedConversationId();

            // Suppress if sender is current user OR message is from the currently open chat
            if (newMsg.senderId !== currentUid && convoId !== activeConvoId) {
              this.handleIncomingNotification(newMsg, convoId);
            }
          }
        });
      }
      isFirstEmit = false;
    });
  }

  private unsubscribe() {
    if (this.messagesUnsubscribe) {
      this.messagesUnsubscribe();
      this.messagesUnsubscribe = undefined;
    }
  }

  private async handleIncomingNotification(msg: Message, convoId: string) {
    // 1. Play Web Audio synthetic ping sound if enabled
    const soundEnabled = localStorage.getItem('sound_effects') !== 'false';
    if (soundEnabled) {
      this.playSyntheticPing();
    }

    // 2. Trigger browser native notification if enabled
    const notificationsEnabled = localStorage.getItem('notifications') !== 'false';
    if (notificationsEnabled && Notification.permission === 'granted') {
      const sender = this.userService.usersCache()[msg.senderId];
      const currentUid = this.auth.currentUser()?.uid;
      const isMentioned = currentUid && (msg.mentions?.includes(currentUid) || msg.mentions?.includes('all'));

      const senderName = sender?.displayName || 'Someone';
      const title = isMentioned ? `📌 Mentioned by ${senderName}` : senderName;
      try {
        let bodyText = msg.text;
        
        // Decrypt E2EE notification preview text
        if (msg.encryptionVersion === 2) {
          const aesKey = await this.cryptoService.getOrDecryptConversationKey(convoId);
          if (aesKey) {
            bodyText = await this.cryptoService.decryptText(msg.text, aesKey);
          } else {
            bodyText = '[Encrypted Message]';
          }
        }

        new Notification(title, {
          body: bodyText,
          tag: msg.id,
        });
      } catch (e) {
        console.warn('Native notification trigger failed:', e);
      }
    }
  }

  private playSyntheticPing() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
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
        aesKey = await runTransaction(db, async (transaction) => {
          // IMPORTANT: All transaction reads must be executed before writes!
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

          // Fetch public keys for all participants to distribute the keys
          const userRefs = convo.participants.map(pId => doc(db, 'users', pId));
          const userSnaps = await Promise.all(userRefs.map(ref => transaction.get(ref)));

          const publicKeys = userSnaps.map((snap, index) => {
            const pId = convo.participants[index];
            if (!snap.exists()) {
              throw new Error('User profile not found');
            }
            const uData = snap.data();
            if (!uData['publicKey']) {
              const name = uData['displayName'] || uData['username'] || 'User';
              throw new Error(`E2EE_UPGRADE_REQUIRED:${name}`);
            }
            return { uid: pId, pk: uData['publicKey'] };
          });

          // Generate E2EE Group Master Key
          const newAesKey = await this.cryptoService.generateGroupKey();

          // Write envelopes
          for (const { uid, pk } of publicKeys) {
            const encryptedKey = await this.cryptoService.encryptGroupKey(newAesKey, pk);
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
          this.cryptoService.groupKeysCache.set(convoId, aesKey);
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
        updates[`unreadCount.${pId}`] = (convo.unreadCount?.[pId] || 0) + 1;
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

      this.cryptoService.groupKeysCache.set(convoId, resultKey);
      return resultKey;
    } catch (err: any) {
      console.error('Transactional self-heal failed:', err);
      throw err;
    }
  }
}
