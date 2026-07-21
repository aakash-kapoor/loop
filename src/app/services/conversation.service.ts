import { Injectable, effect, inject, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap, from } from 'rxjs';
import { Router } from '@angular/router';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  getDocs,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { Auth } from '../core/auth';
import { UserService } from './user.service';
import { Conversation } from '../models/conversation.model';
import { CryptoService } from './crypto.service';

@Injectable({
  providedIn: 'root',
})
export class ConversationService {
  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly cryptoService = inject(CryptoService);

  readonly conversations = signal<Conversation[]>([]);
  private readonly rawConversations = signal<Conversation[]>([]);
  readonly selectedConversationId = signal<string | null>(null);

  readonly selectedConversation = computed(() => {
    const id = this.selectedConversationId();
    if (!id) return null;
    return this.conversations().find((c) => c.id === id) || null;
  });

  private conversationsUnsubscribe?: () => void;

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      if (user?.uid && user.username) {
        this.subscribeToConversations(user.uid);
      } else {
        this.unsubscribe();
        this.rawConversations.set([]);
        this.selectedConversationId.set(null);
      }
    });

    // Reactive decryption pipeline using toObservable + switchMap to avoid race conditions
    toObservable(this.rawConversations)
      .pipe(
        switchMap((rawList) => from(this.decryptConversationsList(rawList)))
      )
      .subscribe((decryptedList) => {
        this.conversations.set(decryptedList);
      });

    // Reset unread count when a conversation is selected or the authenticated user finishes loading
    effect(() => {
      const convoId = this.selectedConversationId();
      const currentUser = this.auth.currentUser();
      if (convoId && currentUser?.uid) {
        const convoRef = doc(db, 'conversations', convoId);
        updateDoc(convoRef, {
          [`unreadCount.${currentUser.uid}`]: 0,
        }).catch(() => {});
      }
    });
  }

  private async decryptConversationsList(rawList: Conversation[]): Promise<Conversation[]> {
    const isReady = this.cryptoService.isPrivateKeyReady();
    if (!isReady) return rawList;

    try {
      return await Promise.all(
        rawList.map(async (convo) => {
          if (convo.lastMessage && convo.lastMessageEncryptionVersion === 2) {
            // Bypass decryption if flagged as plaintext system message or matching legacy system strings
            if (
              convo.lastMessageIsSystem === true ||
              convo.lastMessage === 'Conversation started' ||
              convo.lastMessage === 'Message deleted' ||
              convo.lastMessage === 'Group deleted by admin' ||
              convo.lastMessage === 'Group created' ||
              convo.lastMessage.startsWith('Group "')
            ) {
              return convo;
            }

            try {
              const aesKey = await this.cryptoService.getOrDecryptConversationKey(convo.id);
              if (aesKey) {
                const decrypted = await this.cryptoService.decryptText(convo.lastMessage, aesKey);
                return { ...convo, lastMessage: decrypted };
              }
            } catch (e) {
              console.warn('Failed to decrypt preview for convo:', convo.id, e);
              return { ...convo, lastMessage: '[Decryption Error]' };
            }
          }
          return convo;
        })
      );
    } catch (err) {
      console.error('Error during batch conversation preview decryption:', err);
      return rawList;
    }
  }

  private subscribeToConversations(uid: string) {
    this.unsubscribe();

    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid),
      orderBy('lastMessageAt', 'desc')
    );

    this.conversationsUnsubscribe = onSnapshot(q, async (snapshot) => {
      const list: Conversation[] = [];
      const allParticipantIds = new Set<string>();

      snapshot.forEach((d) => {
        const convo = { id: d.id, ...d.data() } as Conversation;
        
        // Hide completely if conversation is deleted for everyone
        if (convo.deletedForEveryone) return;

        // Hide conversation only if user deleted it AND no new messages have arrived since
        if (convo.deletedFor?.includes(uid)) {
          const clearedAt = convo.clearedAt?.[uid] || 0;
          if (convo.lastMessageAt <= clearedAt) return;
          // New messages arrived after delete — fall through and show the conversation
        }

        list.push(convo);
        convo.participants.forEach((pId) => {
          if (pId !== uid) {
            allParticipantIds.add(pId);
          }
        });
      });

      this.rawConversations.set(list);

      // Pre-fetch profiles for other participants
      if (allParticipantIds.size > 0) {
        await this.userService.fetchParticipantProfiles(Array.from(allParticipantIds));
      }
    });
  }

  private unsubscribe() {
    if (this.conversationsUnsubscribe) {
      this.conversationsUnsubscribe();
      this.conversationsUnsubscribe = undefined;
    }
  }

  selectConversation(convoId: string | null) {
    this.selectedConversationId.set(convoId);
  }

  async acceptMessageRequest(): Promise<void> {
    const convo = this.selectedConversation();
    if (!convo) throw new Error('No active conversation selected to accept');

    const convoRef = doc(db, 'conversations', convo.id);
    await updateDoc(convoRef, {
      isPending: false,
    });
  }

  // Delete entire conversation for current user
  async deleteConversationForMe(): Promise<void> {
    const convo = this.selectedConversation();
    const user = this.auth.currentUser();
    if (!convo || !user) return;

    this.router.navigate(['/chats']); // navigate first
    this.selectConversation(null);    // then deselect

    const convoRef = doc(db, 'conversations', convo.id);
    await updateDoc(convoRef, {
      deletedFor: arrayUnion(user.uid),
      [`clearedAt.${user.uid}`]: Date.now() // capture fresh-start timestamp at delete time
    });
  }

  // Delete group for everyone (Admin capability)
  async deleteGroupForEveryone(convoId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) throw new Error('User not logged in');

    const convo = this.selectedConversation();
    if (!convo || convo.id !== convoId || convo.type !== 'group' || !convo.admins?.includes(user.uid)) {
      throw new Error('Only group administrators can delete this group for everyone.');
    }

    const convoRef = doc(db, 'conversations', convoId);
    await updateDoc(convoRef, {
      deletedForEveryone: true,
      lastMessage: 'Group deleted by admin',
      lastMessageAt: Date.now(),
    });

    this.router.navigate(['/chats']); // navigate after write success
    this.selectConversation(null);    // then deselect
  }

  // Clear all messages for current user (by timestamp)
  async clearChatForMe(): Promise<void> {
    const convo = this.selectedConversation();
    const user = this.auth.currentUser();
    if (!convo || !user) return;

    const convoRef = doc(db, 'conversations', convo.id);
    await updateDoc(convoRef, {
      [`clearedAt.${user.uid}`]: Date.now()
    });
  }

  private async fetchUserPublicKey(uid: string): Promise<string> {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      throw new Error('User not found.');
    }
    const data = userSnap.data();
    if (!data['publicKey']) {
      const name = data['displayName'] || data['username'] || 'User';
      throw new Error(`E2EE_UPGRADE_REQUIRED:${name}`);
    }
    return data['publicKey'];
  }

  private async generateAndUploadEnvelopes(
    convoId: string,
    participants: string[]
  ): Promise<CryptoKey> {
    const aesKey = await this.cryptoService.generateGroupKey();
    
    // Fetch all public keys in parallel directly from Firestore (no cache)
    const publicKeys = await Promise.all(
      participants.map(async (uid) => {
        const pk = await this.fetchUserPublicKey(uid);
        return { uid, pk };
      })
    );
    
    // Encrypt the AES key for each participant and write envelopes
    await Promise.all(
      publicKeys.map(async ({ uid, pk }) => {
        const encryptedKey = await this.cryptoService.encryptGroupKey(aesKey, pk);
        const envelopeRef = doc(db, 'conversations', convoId, 'keys', uid);
        await setDoc(envelopeRef, { encryptedKey });
      })
    );
    
    // Cache the AES key locally
    this.cryptoService.groupKeysCache.set(convoId, aesKey);
    return aesKey;
  }

  async startConversation(recipientUid: string): Promise<string> {
    const currentUser = this.auth.currentUser();
    if (!currentUser) throw new Error('User not logged in');

    // Check if DM conversation already exists
    const dmsQuery = query(
      collection(db, 'conversations'),
      where('type', '==', 'dm'),
      where('participants', 'array-contains', currentUser.uid)
    );

    const snapshot = await getDocs(dmsQuery);
    let existingId: string | null = null;

    snapshot.forEach((d) => {
      const convo = d.data() as Conversation;
      if (convo.participants.includes(recipientUid)) {
        existingId = d.id;
      }
    });

    if (existingId) {
      // Restore visibility — clearedAt was already set at delete time so old messages stay hidden
      const existingRef = doc(db, 'conversations', existingId);
      await updateDoc(existingRef, {
        deletedFor: arrayRemove(currentUser.uid)
      });
      return existingId;
    }

    // Verify both participants have E2EE setup before creating conversation
    await this.fetchUserPublicKey(currentUser.uid);
    await this.fetchUserPublicKey(recipientUid);

    // Create a new DM
    const newConvo: Omit<Conversation, 'id'> = {
      type: 'dm',
      participants: [currentUser.uid, recipientUid],
      isPending: true,
      initiatedBy: currentUser.uid,
      lastMessage: 'Conversation started',
      lastMessageAt: Date.now(),
      unreadCount: {
        [recipientUid]: 1,
        [currentUser.uid]: 0,
      },
      lastMessageEncryptionVersion: 2,
    };

    const convoRef = await addDoc(collection(db, 'conversations'), newConvo);

    // Distribute envelopes
    await this.generateAndUploadEnvelopes(convoRef.id, [currentUser.uid, recipientUid]);

    // Initial message (kept as plaintext system message)
    await addDoc(collection(db, 'conversations', convoRef.id, 'messages'), {
      senderId: 'system',
      text: 'Conversation started',
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      reactions: {},
      replyTo: null,
    });

    return convoRef.id;
  }

  async startGroupConversation(name: string, participantUids: string[]): Promise<string> {
    const currentUser = this.auth.currentUser();
    if (!currentUser) throw new Error('User not logged in');

    const allParticipants = [currentUser.uid, ...participantUids];

    // Verify all participants have E2EE setup before creating group
    await Promise.all(allParticipants.map(uid => this.fetchUserPublicKey(uid)));

    const newGroupConvo: Omit<Conversation, 'id'> = {
      type: 'group',
      participants: allParticipants,
      groupName: name.trim(),
      isPending: false,
      lastMessage: 'Group created',
      lastMessageAt: Date.now(),
      unreadCount: allParticipants.reduce((acc, pId) => {
        acc[pId] = pId === currentUser.uid ? 0 : 1;
        return acc;
      }, {} as Record<string, number>),
      lastMessageEncryptionVersion: 2,
      admins: [currentUser.uid],
      creatorId: currentUser.uid,
    };

    const convoRef = await addDoc(collection(db, 'conversations'), newGroupConvo);

    // Distribute envelopes
    await this.generateAndUploadEnvelopes(convoRef.id, allParticipants);

    // Initial message
    await addDoc(collection(db, 'conversations', convoRef.id, 'messages'), {
      senderId: 'system',
      text: `Group "${name.trim()}" created by ${currentUser.displayName}`,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      reactions: {},
      replyTo: null,
    });

    return convoRef.id;
  }
}
