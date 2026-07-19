import { Injectable, effect, inject, signal, computed } from '@angular/core';
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
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { Auth } from '../core/auth';
import { UserService } from './user.service';
import { Conversation } from '../models/conversation.model';

@Injectable({
  providedIn: 'root',
})
export class ConversationService {
  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  readonly conversations = signal<Conversation[]>([]);
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
        this.conversations.set([]);
        this.selectedConversationId.set(null);
      }
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

      this.conversations.set(list);

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
    };

    const convoRef = await addDoc(collection(db, 'conversations'), newConvo);

    // Initial message
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
    };

    const convoRef = await addDoc(collection(db, 'conversations'), newGroupConvo);

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
