import { Component, Input, Output, EventEmitter, inject, computed, signal, HostListener, ElementRef } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { Message } from '../../models/message.model';
import { Auth } from '../../core/auth';
import { UserService } from '../../services/user.service';
import { MessageService } from '../../services/message.service';
import { Avatar } from '../../shared/avatar/avatar';

@Component({
  selector: 'app-message-bubble',
  imports: [NgClass, DatePipe, Avatar],
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

  // Check if deleted for me
  readonly isDeletedForMe = computed(() => {
    const msg = this.messageSignal();
    const uid = this.currentUserId();
    return uid ? (msg?.deletedFor?.includes(uid) ?? false) : false;
  });

  // Check if deletedForEveryone
  readonly isDeletedForEveryone = computed(() =>
    this.messageSignal()?.deletedForEveryone === true
  );

  // Check if within 15 minute delete window and sender is current user
  readonly canDeleteForEveryone = computed(() => {
    const msg = this.messageSignal();
    if (!msg || msg.senderId !== this.currentUserId()) return false;
    if (msg.deletedForEveryone) return false;

    const createdAt = msg.createdAtMs
      ?? (msg.createdAt instanceof Object
        ? (msg.createdAt as any).toMillis()   // Firestore Timestamp
        : msg.createdAt);                       // plain number fallback

    if (!createdAt) return false;
    const fifteenMinutes = 15 * 60 * 1000;
    return Date.now() - createdAt < fifteenMinutes;
  });

  async deleteForMe() {
    const msg = this.messageSignal();
    if (!msg) return;
    try {
      await this.messageService.deleteMessageForMe(msg.id);
    } catch (err) {
      console.error('Delete for me failed:', err);
    }
  }

  async deleteForEveryone() {
    const msg = this.messageSignal();
    if (!msg || !this.canDeleteForEveryone()) return;
    try {
      await this.messageService.deleteMessageForEveryone(msg.id);
    } catch (err) {
      console.error('Delete for everyone failed:', err);
    }
  }
}
