import { Injectable, effect, inject, signal } from '@angular/core';
import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  runTransaction
} from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { Auth } from '../core/auth';
import { ConversationService } from './conversation.service';
import { Message } from '../models/message.model';

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly auth = inject(Auth);
  private readonly conversationService = inject(ConversationService);

  readonly activeMessages = signal<Message[]>([]);

  private messagesUnsubscribe?: () => void;

  constructor() {
    // Automatically manage message subscription based on selected conversation
    effect(() => {
      const convo = this.conversationService.selectedConversation();
      if (convo?.id) {
        this.subscribeToMessages(convo.id);
      } else {
        this.unsubscribe();
        this.activeMessages.set([]);
      }
    });
  }

  private subscribeToMessages(convoId: string) {
    this.unsubscribe();

    const q = query(
      collection(db, 'conversations', convoId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    this.messagesUnsubscribe = onSnapshot(q, (snapshot) => {
      const list: Message[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as Message);
      });
      this.activeMessages.set(list);
    });
  }

  private unsubscribe() {
    if (this.messagesUnsubscribe) {
      this.messagesUnsubscribe();
      this.messagesUnsubscribe = undefined;
    }
  }

  async sendMessage(text: string, replyTo?: string): Promise<void> {
    const convo = this.conversationService.selectedConversation();
    const user = this.auth.currentUser();
    if (!convo || !user) throw new Error('No selected conversation or user');

    const messageData = {
      senderId: user.uid,
      text: text.trim(),
      createdAt: Date.now(),
      reactions: {},
      replyTo: replyTo || null,
    };

    const messagesRef = collection(db, 'conversations', convo.id, 'messages');
    await addDoc(messagesRef, messageData);

    // Update conversation metadata
    const convoRef = doc(db, 'conversations', convo.id);
    const updates: Record<string, any> = {
      lastMessage: text.trim(),
      lastMessageAt: Date.now(),
    };

    convo.participants.forEach((pId) => {
      if (pId !== user.uid) {
        updates[`unreadCount.${pId}`] = (convo.unreadCount?.[pId] || 0) + 1;
      }
    });

    await updateDoc(convoRef, updates);
  }

  async toggleReaction(messageId: string, emoji: string): Promise<void> {
    const convo = this.conversationService.selectedConversation();
    const user = this.auth.currentUser();
    if (!convo || !user) return;

    const messageRef = doc(db, 'conversations', convo.id, 'messages', messageId);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(messageRef);
      if (!snap.exists()) return;

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
  }
}
