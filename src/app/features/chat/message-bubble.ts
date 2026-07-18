import { Component, Input, Output, EventEmitter, inject, computed, signal, HostListener, ElementRef } from '@angular/core';
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
  readonly messageSignal = signal<Message | null>(null);
  
  // Track tap-to-open state for mobile devices
  readonly isMenuOpen = signal<boolean>(false);

  @Input({ required: true }) set message(val: Message) {
    this.messageSignal.set(val);
  }
  get message(): Message {
    return this.messageSignal()!;
  }

  @Input() replyToMessage: Message | null = null;
  @Input() showSenderName = false;

  @Output() reply = new EventEmitter<Message>();

  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly elementRef = inject(ElementRef);

  readonly currentUserId = computed(() => this.auth.currentUser()?.uid);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const clickedInside = this.elementRef.nativeElement.contains(event.target as Node);
    if (!clickedInside) {
      this.isMenuOpen.set(false);
    }
  }

  toggleMenu(event: Event) {
    this.isMenuOpen.set(!this.isMenuOpen());
  }
  
  readonly isOutgoing = computed(() => {
    const msg = this.messageSignal();
    return msg ? msg.senderId === this.currentUserId() : false;
  });
  
  readonly senderProfile = computed(() => {
    const msg = this.messageSignal();
    if (!msg || msg.senderId === 'system') return null;
    return this.userService.usersCache()[msg.senderId] || null;
  });

  readonly reactionsList = computed(() => {
    const msg = this.messageSignal();
    if (!msg) return [];
    
    const list: { emoji: string; count: number; active: boolean; uids: string[] }[] = [];
    const rx = msg.reactions || {};
    const uid = this.currentUserId();

    Object.entries(rx).forEach(([emoji, val]) => {
      const uids = val as string[];
      if (uids && uids.length > 0) {
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
    const msg = this.messageSignal();
    if (!msg) return;
    
    try {
      await this.messageService.toggleReaction(msg.id, emoji);
    } catch (err) {
      console.error('Reaction toggle failed in bubble component:', err);
    }
  }

  onReply() {
    const msg = this.messageSignal();
    if (msg) {
      this.reply.emit(msg);
    }
  }
}
