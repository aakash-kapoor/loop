import { Component, Input, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { Conversation } from '../../../models/conversation.model';
import { Auth } from '../../../core/auth';
import { UserService } from '../../../services/user.service';
import { ConversationService } from '../../../services/conversation.service';
import { DatePipe, NgClass } from '@angular/common';

@Component({
  selector: 'app-conversation-item',
  imports: [NgClass, DatePipe],
  templateUrl: './conversation-item.html',
  styleUrl: './conversation-item.scss',
})
export class ConversationItem {
  @Input({ required: true }) convo!: Conversation;

  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);
  private readonly router = inject(Router);

  // Get the other participant's UID (for DM)
  readonly otherParticipantUid = computed(() => {
    const currentUid = this.auth.currentUser()?.uid;
    return this.convo.participants.find(uid => uid !== currentUid);
  });

  // Get other participant's profile
  readonly otherProfile = computed(() => {
    const uid = this.otherParticipantUid();
    if (!uid) return null;
    return this.userService.usersCache()[uid] || null;
  });

  // Check if active
  readonly isActive = computed(() => {
    return this.conversationService.selectedConversation()?.id === this.convo.id;
  });

  // Unread count for current user
  readonly unreadCount = computed(() => {
    const currentUid = this.auth.currentUser()?.uid;
    if (!currentUid) return 0;
    return this.convo.unreadCount?.[currentUid] || 0;
  });

  // Check if it's a pending message request for the current user
  readonly isMessageRequest = computed(() => {
    const currentUid = this.auth.currentUser()?.uid;
    return this.convo.isPending && this.convo.initiatedBy !== currentUid;
  });

  select() {
    this.conversationService.selectConversation(this.convo.id);
    this.router.navigate(['/chats', this.convo.id]);
  }
}
