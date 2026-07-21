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

  // Error message shown when delete-for-everyone fails (e.g. window expired)
  readonly deleteError = signal<string | null>(null);

  // Clock tick signal so canDeleteForEveryone re-evaluates as time passes (every 30s)
  private readonly clockTick = signal(Date.now());
  private readonly clockInterval = setInterval(() => this.clockTick.set(Date.now()), 30_000);

  @Input({ required: true }) set message(val: Message) {
    this.messageSignal.set(val);
  }
  get message(): Message {
    return this.messageSignal()!;
  }

  readonly replyToMessageSignal = signal<Message | null>(null);

  @Input() set replyToMessage(val: Message | null) {
    this.replyToMessageSignal.set(val);
  }
  get replyToMessage(): Message | null {
    return this.replyToMessageSignal();
  }

  @Input() showSenderName = false;

  readonly searchTermSignal = signal<string>('');
  @Input() set searchTerm(val: string) {
    this.searchTermSignal.set(val || '');
  }
  get searchTerm(): string {
    return this.searchTermSignal();
  }

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

  readonly replyToSenderName = computed(() => {
    const replyMsg = this.replyToMessageSignal();
    if (!replyMsg) return '';
    if (replyMsg.senderId === this.currentUserId()) return 'You';
    const user = this.userService.usersCache()[replyMsg.senderId];
    return user?.displayName || user?.username || 'User';
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

  readonly textChunks = computed(() => {
    const text = this.messageSignal()?.text || '';
    const rawQuery = this.searchTermSignal();
    const query = rawQuery.trim();
    if (!query || this.isDeletedForEveryone() || this.isDeletedForMe()) {
      return [{ text, isMatch: false }];
    }

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part) => ({
      text: part,
      isMatch: part.toLowerCase() === query.toLowerCase(),
    }));
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
    this.clockTick(); // depend on clock so this re-evaluates every 30s
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
      const message = 'Delete window expired — can only delete within 15 minutes';
      this.deleteError.set(message);
      setTimeout(() => this.deleteError.set(null), 3000);
    }
  }
}
