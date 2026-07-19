import { Injectable, effect, inject, signal } from '@angular/core';
import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  runTransaction,
  arrayUnion,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { Auth } from '../core/auth';
import { ConversationService } from './conversation.service';
import { UserService } from './user.service';
import { Message } from '../models/message.model';

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly auth = inject(Auth);
  private readonly conversationService = inject(ConversationService);
  private readonly userService = inject(UserService);

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

    let isFirstEmit = true;

    this.messagesUnsubscribe = onSnapshot(q, (snapshot) => {
      const user = this.auth.currentUser();
      const clearedAt = this.conversationService
        .selectedConversation()?.clearedAt?.[user?.uid || ''] || 0;

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
          msg.senderId === 'system' || (
            !msg.deletedFor?.includes(user?.uid || '') &&
            (msg.createdAt || 0) >= clearedAt
          )
        );

      this.activeMessages.set(list);

      // Trigger alerts only on new incoming messages after the initial subscription fetch
      if (!isFirstEmit) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const newMsg = { id: change.doc.id, ...change.doc.data() } as Message;
            const currentUid = this.auth.currentUser()?.uid;

            // Trigger alert only if sender is not the current user
            if (newMsg.senderId !== currentUid) {
              this.handleIncomingNotification(newMsg);
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

  private handleIncomingNotification(msg: Message) {
    // 1. Play Web Audio synthetic ping sound if enabled
    const soundEnabled = localStorage.getItem('sound_effects') !== 'false';
    if (soundEnabled) {
      this.playSyntheticPing();
    }

    // 2. Trigger browser native notification if enabled
    const notificationsEnabled = localStorage.getItem('notifications') !== 'false';
    if (notificationsEnabled && Notification.permission === 'granted') {
      const sender = this.userService.usersCache()[msg.senderId];
      const title = sender?.displayName || 'New Message';
      try {
        new Notification(title, {
          body: msg.text,
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

  async sendMessage(text: string, replyTo?: string): Promise<void> {
    const convo = this.conversationService.selectedConversation();
    const user = this.auth.currentUser();
    if (!convo || !user) throw new Error('No selected conversation or user');

    const now = Date.now();
    const messageData = {
      senderId: user.uid,
      text: text.trim(),
      createdAt: serverTimestamp(),
      createdAtMs: now,
      reactions: {},
      replyTo: replyTo || null,
    };

    const messagesRef = collection(db, 'conversations', convo.id, 'messages');
    await addDoc(messagesRef, messageData);

    // Update conversation metadata
    const convoRef = doc(db, 'conversations', convo.id);
    const updates: Record<string, any> = {
      lastMessage: text.trim(),
      lastMessageAt: now,
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
}
