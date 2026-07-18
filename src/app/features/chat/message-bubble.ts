import { Component, Input, Output, EventEmitter, inject, computed } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { Message } from '../../models/message.model';
import { Auth } from '../../core/auth';
import { UserService } from '../../services/user.service';
import { MessageService } from '../../services/message.service';

@Component({
  selector: 'app-message-bubble',
  imports: [NgClass, DatePipe],
  templateUrl: './message-bubble.html',
  styleUrl: './message-bubble.scss',
})
export class MessageBubble {
  @Input({ required: true }) message!: Message;
  @Input() replyToMessage: Message | null = null;
  @Input() showSenderName = false;

  @Output() reply = new EventEmitter<Message>();

  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  readonly currentUserId = computed(() => this.auth.currentUser()?.uid);
  
  readonly isOutgoing = computed(() => this.message.senderId === this.currentUserId());
  
  readonly senderProfile = computed(() => {
    if (this.message.senderId === 'system') return null;
    return this.userService.usersCache()[this.message.senderId] || null;
  });

  readonly reactionsList = computed(() => {
    const list: { emoji: string; count: number; active: boolean; uids: string[] }[] = [];
    const rx = this.message.reactions || {};
    const uid = this.currentUserId();

    Object.entries(rx).forEach(([emoji, uids]) => {
      if (uids.length > 0) {
        list.push({
          emoji,
          count: uids.length,
          active: uid ? uids.includes(uid) : false,
          uids,
        });
      }
    });

    return list;
  });

  async react(emoji: string) {
    await this.messageService.toggleReaction(this.message.id, emoji);
  }

  onReply() {
    this.reply.emit(this.message);
  }
}
