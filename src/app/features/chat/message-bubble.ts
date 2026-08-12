import { Component, Input, Output, EventEmitter, inject, computed, signal, HostListener, ElementRef, OnDestroy, AfterViewInit, viewChild } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { Message, MessageAttachment } from '../../models/message.model';
import { Auth } from '../../core/auth';
import { UserService } from '../../services/user.service';
import { MessageService } from '../../services/message.service';
import { LiveKitService } from '../../services/livekit.service';
import { ConversationService } from '../../services/conversation.service';
import { Avatar } from '../../shared/avatar/avatar';
import { dataUrlToBlob, downloadBlob, formatBytes } from '../../shared/utils/image-compressor';

@Component({
  selector: 'app-message-bubble',
  imports: [NgClass, DatePipe, Avatar],
  templateUrl: './message-bubble.html',
  styleUrl: './message-bubble.scss',
})
export class MessageBubble implements AfterViewInit, OnDestroy {
  private readonly liveKitService = inject(LiveKitService);
  private readonly conversationService = inject(ConversationService);
  readonly messageSignal = signal<Message | null>(null);

  // Lightbox overlay state for full-resolution image preview
  readonly selectedLightboxImage = signal<string | null>(null);

  // Track tap-to-open state for mobile devices
  readonly isMenuOpen = signal<boolean>(false);

  // Context menu (actions dropdown) open state
  readonly isContextMenuOpen = signal<boolean>(false);
  readonly openUpward = signal<boolean>(false);

  // Error message shown when delete-for-everyone fails (e.g. window expired)
  readonly deleteError = signal<string | null>(null);

  // Swipe to reply touch gesture signals
  readonly swipeOffset = signal<number>(0);
  readonly isSwiping = signal<boolean>(false);
  readonly isSwipeThresholdReached = signal<boolean>(false);

  // Computed scale for reply action indicator badge
  readonly swipeBadgeScale = computed(() => {
    const offset = this.swipeOffset();
    if (offset <= 0) return 0;
    return Math.min(1, offset / 35);
  });

  private readonly swipeContainerRef = viewChild<ElementRef<HTMLElement>>('swipeContainer');
  private touchMoveListener?: (e: TouchEvent) => void;

  private touchStartX = 0;
  private touchStartY = 0;
  private isDirectionLocked = false;
  private isSwipingHorizontal = false;

  // Clock tick signal so canDeleteForEveryone re-evaluates as time passes (every 30s)
  private readonly clockTick = signal(Date.now());
  private readonly clockInterval = setInterval(() => this.clockTick.set(Date.now()), 30_000);

  @Input({ required: true }) set message(val: Message) {
    this.resetSwipeState();
    this.messageSignal.set(val);
  }
  get message(): Message {
    return this.messageSignal()!;
  }

  callBack(audioOnly: boolean = false): void {
    const convo = this.conversationService.selectedConversation();
    if (convo) {
      this.liveKitService.initiateCall(convo, audioOnly);
    }
  }

  isCallOutgoing(): boolean {
    if (!this.message.callLog) return this.isOutgoing();
    return this.message.callLog.callerUid === this.auth.currentUser()?.uid;
  }

  readonly replyToMessageSignal = signal<Message | null>(null);

  @Input() set replyToMessage(val: Message | null) {
    this.replyToMessageSignal.set(val);
  }
  get replyToMessage(): Message | null {
    return this.replyToMessageSignal();
  }

  @Input() showSenderName = false;
  @Input() isPinned = false;
  @Input() isHighlighted = false;

  readonly searchTermSignal = signal<string>('');
  @Input() set searchTerm(val: string) {
    this.searchTermSignal.set(val || '');
  }
  get searchTerm(): string {
    return this.searchTermSignal();
  }

  @Output() reply = new EventEmitter<Message>();
  @Output() replyClick = new EventEmitter<Message>();
  @Output() pin = new EventEmitter<Message>();
  @Output() unpin = new EventEmitter<Message>();
  @Output() imageClick = new EventEmitter<string>();
  @Output() forward = new EventEmitter<Message>();

  onReplyToClick(event: Event) {
    event.stopPropagation();
    const replyMsg = this.replyToMessageSignal();
    if (replyMsg) {
      this.replyClick.emit(replyMsg);
    }
  }

  /** All conversation participants — needed for read-receipt status. */
  @Input() participants: string[] = [];

  public readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly elementRef = inject(ElementRef);

  readonly currentUserId = computed(() => this.auth.currentUser()?.uid);

  ngAfterViewInit() {
    const el = this.swipeContainerRef()?.nativeElement;
    if (el) {
      this.touchMoveListener = (e: TouchEvent) => this.onTouchMove(e);
      el.addEventListener('touchmove', this.touchMoveListener, { passive: false });
    }
  }

  resetSwipeState() {
    this.swipeOffset.set(0);
    this.isSwiping.set(false);
    this.isSwipeThresholdReached.set(false);
    this.isDirectionLocked = false;
    this.isSwipingHorizontal = false;
  }

  onTouchStart(event: TouchEvent) {
    if (this.isDeletedForEveryone() || this.isDeletedForMe()) return;
    if (event.touches.length > 1) return;

    // Ignore touch gestures originating inside quick action bar or context menu dropdown
    const target = event.target as HTMLElement | null;
    if (target && target.closest('.quick-action-bar')) {
      return;
    }

    const touch = event.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.isDirectionLocked = false;
    this.isSwipingHorizontal = false;
    this.isSwiping.set(true);

    if (this.isMenuOpen() || this.isContextMenuOpen()) {
      this.isMenuOpen.set(false);
      this.isContextMenuOpen.set(false);
    }
  }

  onTouchMove(event: TouchEvent) {
    if (!this.isSwiping() || this.isDeletedForEveryone() || this.isDeletedForMe()) return;
    if (event.touches.length > 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = touch.clientY - this.touchStartY;

    if (!this.isDirectionLocked) {
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < 5) return; // Wait for minimum movement before direction lock

      this.isDirectionLocked = true;
      this.isSwipingHorizontal = deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY);

      if (!this.isSwipingHorizontal) {
        this.isSwiping.set(false);
        this.swipeOffset.set(0);
        return;
      }
    }

    if (this.isSwipingHorizontal) {
      if (event.cancelable) {
        event.preventDefault();
      }

      const dampenedOffset = Math.min(65, deltaX * 0.45);
      this.swipeOffset.set(Math.max(0, dampenedOffset));

      const threshold = 45;
      const wasReached = this.isSwipeThresholdReached();
      const isReached = dampenedOffset >= threshold;

      if (isReached && !wasReached) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(25);
          } catch (_) {}
        }
      }

      this.isSwipeThresholdReached.set(isReached);
    }
  }

  onTouchEnd() {
    if (!this.isSwiping() && this.swipeOffset() === 0) return;

    const thresholdReached = this.isSwipeThresholdReached();
    this.isSwiping.set(false);

    if (thresholdReached) {
      this.onReply();
    }

    this.swipeOffset.set(0);
    this.isSwipeThresholdReached.set(false);
    this.isDirectionLocked = false;
    this.isSwipingHorizontal = false;
  }

  onTouchCancel() {
    this.resetSwipeState();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const clickedInside = this.elementRef.nativeElement.contains(event.target as Node);
    if (!clickedInside) {
      this.isMenuOpen.set(false);
      this.isContextMenuOpen.set(false);
    }
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.isMenuOpen.set(false);
    this.isContextMenuOpen.set(false);
  }

  toggleMenu(event: Event) {
    if (this.swipeOffset() > 0) return;
    this.isContextMenuOpen.set(false);
    this.isMenuOpen.set(!this.isMenuOpen());
  }

  toggleContextMenu(event: Event) {
    event.stopPropagation();
    if (!this.isContextMenuOpen()) {
      const btn = event.currentTarget as HTMLElement;
      if (btn) {
        const rect = btn.getBoundingClientRect();
        // If button is in lower half of viewport, open menu upward to prevent bottom layout overflow
        this.openUpward.set(rect.top > window.innerHeight / 2);
      }
    }
    this.isContextMenuOpen.set(!this.isContextMenuOpen());
  }

  readonly isOutgoing = computed(() => {
    const msg = this.messageSignal();
    return msg ? msg.senderId === this.currentUserId() : false;
  });

  readonly senderProfile = computed(() => {
    const msg = this.messageSignal();
    if (!msg) return null;

    if (msg.callLog?.callerUid) {
      const profile = this.userService.usersCache()[msg.callLog.callerUid];
      if (!profile) {
        this.userService.getUserProfile(msg.callLog.callerUid);
      }
      return profile || ({ displayName: msg.callLog.callerName, uid: msg.callLog.callerUid } as any);
    }

    if (msg.senderId === 'system') return null;
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

  readonly isCurrentMentioned = computed(() => {
    const msg = this.messageSignal();
    const uid = this.currentUserId();
    if (!msg || !uid || msg.deletedForEveryone || msg.deletedFor?.includes(uid)) return false;
    return Boolean(msg.mentions?.includes(uid) || msg.mentions?.includes('all'));
  });

  readonly formattedMessageChunks = computed(() => {
    const text = this.messageSignal()?.text || '';
    if (!text || this.isDeletedForEveryone() || this.isDeletedForMe()) {
      return [{ text, isMatch: false, isMention: false }];
    }

    const searchQuery = this.searchTermSignal().trim();
    const mentionRegexStr = `@[A-Za-z0-9_.-]+`;

    let fullRegex: RegExp;
    if (searchQuery) {
      const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      fullRegex = new RegExp(`(${mentionRegexStr}|${escapedQuery})`, 'gi');
    } else {
      fullRegex = new RegExp(`(${mentionRegexStr})`, 'gi');
    }

    const parts = text.split(fullRegex);

    return parts.map((part) => {
      const isSearchMatch = Boolean(searchQuery && part.toLowerCase() === searchQuery.toLowerCase());
      const isMentionTag = /^@[A-Za-z0-9_.-]+$/.test(part);

      return {
        text: part,
        isMatch: isSearchMatch,
        isMention: isMentionTag,
      };
    });
  });

  readonly emojiInfo = computed(() => {
    const text = this.messageSignal()?.text || '';
    if (!text || this.isDeletedForEveryone() || this.isDeletedForMe()) {
      return { isEmojiOnly: false, count: 0 };
    }
    if (this.imageAttachments().length > 0 || this.documentAttachments().length > 0) {
      return { isEmojiOnly: false, count: 0 };
    }
    return isPureEmojiMessage(text);
  });

  readonly isEmojiOnly = computed(() => this.emojiInfo().isEmojiOnly);

  readonly emojiSizeClass = computed(() => {
    const { isEmojiOnly, count } = this.emojiInfo();
    if (!isEmojiOnly) return '';

    if (count === 1) return 'text-4xl sm:text-5xl leading-tight py-1';
    if (count === 2) return 'text-3xl sm:text-4xl leading-tight py-0.5';
    if (count === 3) return 'text-2xl sm:text-3xl leading-tight py-0.5';
    return '';
  });

  async react(emoji: string) {
    this.isMenuOpen.set(false);
    this.isContextMenuOpen.set(false);
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

  onPin() {
    const msg = this.messageSignal();
    if (msg) {
      this.pin.emit(msg);
    }
  }

  onUnpin() {
    const msg = this.messageSignal();
    if (msg) {
      this.unpin.emit(msg);
    }
  }

  onForward() {
    const msg = this.messageSignal();
    if (msg) {
      this.forward.emit(msg);
    }
  }

  /** True when this message was produced by forwarding another message. */
  readonly isForwarded = computed(() => !!this.messageSignal()?.forwardedFrom);

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

  /**
   * Read-receipt status for outgoing messages only.
   * 'seen'  → at least one other participant has seen this message (double tick, accent)
   * 'sent'  → nobody has seen it yet (single tick, muted)
   */
  readonly readStatus = computed<'sent' | 'seen'>(() => {
    const msg = this.messageSignal();
    const uid = this.currentUserId();
    if (!msg || !uid || msg.senderId !== uid) return 'sent';

    const seenBy = msg.seenBy ?? [];
    const seenByOther = this.participants.some(
      (p) => p !== uid && seenBy.includes(p)
    );
    return seenByOther ? 'seen' : 'sent';
  });

  ngOnDestroy() {
    this.resetSwipeState();
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
    const el = this.swipeContainerRef()?.nativeElement;
    if (this.touchMoveListener && el) {
      el.removeEventListener('touchmove', this.touchMoveListener);
    }
  }

  async deleteForMe() {
    const msg = this.messageSignal();
    if (!msg) return;
    try {
      await this.messageService.deleteMessageForMe(msg.id);
    } catch (err) {
      console.error('Delete for me failed:', err);
    }
  }

  readonly attachments = computed<MessageAttachment[]>(() => {
    return this.messageSignal()?.attachments || [];
  });

  readonly imageAttachments = computed<MessageAttachment[]>(() => {
    return this.attachments().filter((a) => a.fileType === 'image');
  });

  readonly documentAttachments = computed<MessageAttachment[]>(() => {
    return this.attachments().filter((a) => a.fileType !== 'image');
  });

  formatFileSize(bytes: number): string {
    return formatBytes(bytes);
  }

  openLightbox(url: string, event?: Event) {
    if (event) event.stopPropagation();
    this.imageClick.emit(url);
  }

  closeLightbox() {
    this.selectedLightboxImage.set(null);
  }

  downloadAttachment(doc: MessageAttachment, event: Event) {
    event.stopPropagation();
    event.preventDefault();
    if (!doc.url) return;

    if (doc.url.startsWith('data:')) {
      try {
        const blob = dataUrlToBlob(doc.url);
        downloadBlob(blob, doc.fileName);
      } catch (err) {
        console.error('Blob reconstruction failed, falling back to direct link download:', err);
        const anchor = document.createElement('a');
        anchor.href = doc.url;
        anchor.download = doc.fileName;
        anchor.click();
      }
    } else {
      const anchor = document.createElement('a');
      anchor.href = doc.url;
      anchor.target = '_blank';
      anchor.download = doc.fileName;
      anchor.click();
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

/**
 * Detects if a text string contains ONLY Unicode emojis and optional whitespace (1–3 emojis only).
 * Uses Intl.Segmenter to segment by grapheme clusters and validates each grapheme individually,
 * preventing false positives from bare digits/symbols that belong to Emoji_Component.
 */
export function isPureEmojiMessage(text: string): { isEmojiOnly: boolean; count: number } {
  const trimmed = text.trim();
  if (!trimmed) return { isEmojiOnly: false, count: 0 };

  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) {
    const containsPictographic = /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(trimmed);
    const onlyEmojiChars = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Component}\uFE0F\u200D\s]+$/u.test(trimmed);
    return { isEmojiOnly: containsPictographic && onlyEmojiChars, count: 0 };
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(trimmed))
    .map((s) => s.segment)
    .filter((s) => s.trim().length > 0);

  if (graphemes.length === 0 || graphemes.length > 3) {
    return { isEmojiOnly: false, count: 0 };
  }

  const allEmoji = graphemes.every((g) => /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(g));

  return {
    isEmojiOnly: allEmoji,
    count: allEmoji ? graphemes.length : 0,
  };
}
