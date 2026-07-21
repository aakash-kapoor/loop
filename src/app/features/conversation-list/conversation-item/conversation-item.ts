import { Component, Input, inject, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Conversation } from '../../../models/conversation.model';
import { Auth } from '../../../core/auth';
import { UserService } from '../../../services/user.service';
import { ConversationService } from '../../../services/conversation.service';
import { NgClass } from '@angular/common';
import { Avatar } from '../../../shared/avatar/avatar';

@Component({
  selector: 'app-conversation-item',
  imports: [NgClass, Avatar],
  templateUrl: './conversation-item.html',
  styleUrl: './conversation-item.scss',
})
export class ConversationItem {
  readonly convoSignal = signal<Conversation | null>(null);

  @Input({ required: true }) set convo(val: Conversation) {
    this.convoSignal.set(val);
  }
  get convo(): Conversation {
    return this.convoSignal()!;
  }

  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);
  private readonly router = inject(Router);

  // Get the other participant's UID (for DM)
  readonly otherParticipantUid = computed(() => {
    const currentUid = this.auth.currentUser()?.uid;
    return this.convoSignal()?.participants.find(uid => uid !== currentUid);
  });

  // Get other participant's profile
  readonly otherProfile = computed(() => {
    const uid = this.otherParticipantUid();
    if (!uid) return null;
    return this.userService.usersCache()[uid] || null;
  });

  // Check if active
  readonly isActive = computed(() => {
    return this.conversationService.selectedConversation()?.id === this.convoSignal()?.id;
  });

  // Unread count for current user
  readonly unreadCount = computed(() => {
    const currentUid = this.auth.currentUser()?.uid;
    if (!currentUid) return 0;
    return this.convoSignal()?.unreadCount?.[currentUid] || 0;
  });

  // Check if cleared for me
  readonly isClearedForMe = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return false;
    const clearedAt = this.convoSignal()?.clearedAt?.[uid] || 0;
    if (clearedAt === 0) return false;
    // Only show "Chat cleared" if no new messages have arrived since the clear
    const lastMessageAt = this.convoSignal()?.lastMessageAt || 0;
    return lastMessageAt <= clearedAt;
  });

  // Check if it's a pending message request for the current user
  readonly isMessageRequest = computed(() => {
    const currentUid = this.auth.currentUser()?.uid;
    const convo = this.convoSignal();
    return convo?.isPending && convo?.initiatedBy !== currentUid;
  });

  // Smart sidebar timestamp (Today -> 3:37 PM, Yesterday -> Yesterday, Older -> 19 Jul)
  readonly formattedTime = computed(() => {
    const timestamp = this.convoSignal()?.lastMessageAt;
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();

    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } else if (isYesterday) {
      return 'Yesterday';
    } else {
      const isSameYear = date.getFullYear() === now.getFullYear();
      return date.toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        ...(isSameYear ? {} : { year: '2-digit' }),
      });
    }
  });

  select() {
    this.conversationService.selectConversation(this.convo.id);
    this.router.navigate(['/chats', this.convo.id]);
  }
}
