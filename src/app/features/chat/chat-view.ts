import { Component, inject, computed, signal, ElementRef, viewChild, AfterViewInit, OnInit, OnDestroy, effect, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Subscription } from 'rxjs';
import { ConversationService } from '../../services/conversation.service';
import { MessageService } from '../../services/message.service';
import { UserService } from '../../services/user.service';
import { Auth } from '../../core/auth';
import { MessageBubble } from './message-bubble';
import { Avatar } from '../../shared/avatar/avatar';
import { Message } from '../../models/message.model';
import { AppUser } from '../../models/user.model';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';

import { GroupInfoModal } from './group-info-modal/group-info-modal';
import { ConfirmModal } from '../../shared/confirm-modal/confirm-modal';

@Component({
  selector: 'app-chat-view',
  imports: [FormsModule, MessageBubble, NgClass, Avatar, PickerComponent, GroupInfoModal, ConfirmModal],
  templateUrl: './chat-view.html',
  styleUrl: './chat-view.scss',
})
export class ChatViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly elementRef = inject(ElementRef);

  readonly conversationService = inject(ConversationService);
  readonly messageService = inject(MessageService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth);

  readonly text = signal<string>('');
  readonly replyingTo = signal<Message | null>(null);
  readonly isHeaderMenuOpen = signal<boolean>(false);
  readonly isGroupInfoOpen = signal<boolean>(false);
  readonly activeConfirmAction = signal<'clear' | 'delete' | null>(null);
  readonly isSubmittingConfirm = signal<boolean>(false);
  readonly isEmojiPickerOpen = signal<boolean>(false);
  readonly isDarkTheme = signal<boolean>(false);
  readonly sendError = signal<string | null>(null);

  // Message Search State Signals
  readonly isSearchOpen = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly currentMatchIndex = signal<number>(0);
  readonly activeHighlightedMessageId = signal<string | null>(null);

  // Group Mention Signals
  readonly isMentionPickerOpen = signal<boolean>(false);
  readonly mentionQuery = signal<string>('');
  readonly mentionSelectedIndex = signal<number>(0);
  readonly mentionedUids = signal<string[]>([]);

  private routeSub?: Subscription;
  private themeObserver?: MutationObserver;
  private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');
  private readonly messageInput = viewChild<ElementRef<HTMLInputElement>>('messageInput');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly currentUserId = computed(() => this.auth.currentUser()?.uid);
  readonly convo = computed(() => this.conversationService.selectedConversation());
  readonly messages = computed(() => this.messageService.activeMessages());

  readonly groupParticipantsForMention = computed(() => {
    const activeConvo = this.convo();
    if (!activeConvo || activeConvo.type !== 'group') return [];

    const currentUid = this.currentUserId();
    const query = this.mentionQuery().toLowerCase().trim();
    const cache = this.userService.usersCache();

    const candidates: { uid: string; name: string; username: string; photoURL?: string; isAll?: boolean }[] = [];

    if (!query || 'all'.includes(query) || 'everyone'.includes(query)) {
      candidates.push({
        uid: 'all',
        name: 'all (Notify everyone)',
        username: 'everyone',
        isAll: true,
      });
    }

    activeConvo.participants.forEach((uid) => {
      if (uid === currentUid) return;
      const user = cache[uid];
      const name = user?.displayName || user?.username || 'User';
      const username = user?.username || '';
      if (!query || name.toLowerCase().includes(query) || username.toLowerCase().includes(query)) {
        candidates.push({
          uid,
          name,
          username,
          photoURL: user?.photoURL,
        });
      }
    });

    return candidates;
  });

  readonly matchingMessages = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const currentUid = this.currentUserId();
    if (!query) return [];

    return this.messages().filter(
      (m) =>
        m.text &&
        !m.deletedForEveryone &&
        !m.deletedFor?.includes(currentUid || '') &&
        m.text.toLowerCase().includes(query)
    );
  });

  readonly currentMatch = computed(() => {
    const matches = this.matchingMessages();
    const idx = this.currentMatchIndex();
    if (matches.length === 0 || idx < 0 || idx >= matches.length) return null;
    return matches[idx];
  });

  readonly isAdmin = computed(() => {
    const c = this.convo();
    const uid = this.currentUserId();
    if (!c || !uid) return false;
    return c.type === 'group' && c.admins?.includes(uid);
  });

  // Check if DM is pending acceptance
  readonly isPending = computed(() => this.convo()?.isPending || false);
  readonly initiatedByMe = computed(() => this.convo()?.initiatedBy === this.currentUserId());

  // If it is pending and NOT initiated by current user, it is a message request banner
  readonly isMessageRequest = computed(() => this.isPending() && !this.initiatedByMe());

  // Get the chat partner profile for DMs
  readonly chatPartner = computed(() => {
    const activeConvo = this.convo();
    if (!activeConvo || activeConvo.type !== 'dm') return null;
    const partnerUid = activeConvo.participants.find((uid: string) => uid !== this.currentUserId());
    if (!partnerUid) return null;
    return this.userService.usersCache()[partnerUid] || null;
  });

  constructor() {
    // Auto-scroll to bottom when new messages arrive (only if search query is empty)
    effect(() => {
      const msgs = this.messages();
      if (msgs.length > 0 && !this.searchQuery().trim()) {
        setTimeout(() => this.scrollToBottom(), 30);
      }
    });

    // Reset match index and scroll to first match when searchQuery changes
    effect(() => {
      const matches = this.matchingMessages();
      if (matches.length > 0) {
        this.currentMatchIndex.set(0);
        const firstMatchId = matches[0].id;
        setTimeout(() => this.scrollToMatch(firstMatchId), 50);
      } else {
        this.activeHighlightedMessageId.set(null);
      }
    });
  }

  ngOnInit() {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      this.conversationService.selectConversation(id);
      this.replyingTo.set(null);
      this.text.set('');
      this.isEmojiPickerOpen.set(false);
      this.sendError.set(null);
      this.closeSearch();
    });

    // Reactive Theme Observer
    this.isDarkTheme.set(document.documentElement.classList.contains('dark'));
    this.themeObserver = new MutationObserver(() => {
      this.isDarkTheme.set(document.documentElement.classList.contains('dark'));
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
    this.themeObserver?.disconnect();
    // Deselect conversation on destroy
    this.conversationService.selectConversation(null);
  }

  scrollToBottom() {
    const el = this.messagesContainer()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  onTextInput() {
    const inputEl = this.messageInput()?.nativeElement;
    if (!inputEl || this.convo()?.type !== 'group') {
      this.isMentionPickerOpen.set(false);
      return;
    }

    const val = this.text();
    const cursorPos = inputEl.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);

    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (/\s/.test(charBeforeAt)) {
        const queryCandidate = textBeforeCursor.slice(lastAtIndex + 1);
        if (!/\s/.test(queryCandidate)) {
          this.mentionQuery.set(queryCandidate);
          this.isMentionPickerOpen.set(true);
          this.mentionSelectedIndex.set(0);
          return;
        }
      }
    }

    this.isMentionPickerOpen.set(false);
  }

  selectMention(candidate: { uid: string; name: string; username: string; isAll?: boolean }) {
    const inputEl = this.messageInput()?.nativeElement;
    const val = this.text();
    const cursorPos = inputEl?.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const textAfterCursor = val.slice(cursorPos);

    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const prefix = val.slice(0, lastAtIndex);
      const mentionDisplayName = candidate.isAll ? 'all' : candidate.name.split(' ')[0];
      const mentionText = `@${mentionDisplayName} `;
      const newText = prefix + mentionText + textAfterCursor;
      this.text.set(newText);

      if (!this.mentionedUids().includes(candidate.uid)) {
        this.mentionedUids.set([...this.mentionedUids(), candidate.uid]);
      }

      this.isMentionPickerOpen.set(false);

      queueMicrotask(() => {
        if (inputEl) {
          const newCursorPos = lastAtIndex + mentionText.length;
          inputEl.setSelectionRange(newCursorPos, newCursorPos);
          inputEl.focus();
        }
      });
    }
  }

  onInputKeydown(event: KeyboardEvent) {
    if (this.isMentionPickerOpen()) {
      const candidates = this.groupParticipantsForMention();
      if (candidates.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.mentionSelectedIndex.set((this.mentionSelectedIndex() + 1) % candidates.length);
          return;
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.mentionSelectedIndex.set((this.mentionSelectedIndex() - 1 + candidates.length) % candidates.length);
          return;
        } else if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          const selected = candidates[this.mentionSelectedIndex()];
          if (selected) {
            this.selectMention(selected);
          }
          return;
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.isMentionPickerOpen.set(false);
          return;
        }
      }
    }

    if (event.key === 'Enter') {
      this.send();
    }
  }

  async send() {
    const messageText = this.text().trim();
    if (!messageText) return;

    this.sendError.set(null);
    try {
      await this.messageService.sendMessage(messageText, this.replyingTo()?.id, this.mentionedUids());
      this.text.set('');
      this.replyingTo.set(null);
      this.mentionedUids.set([]);
      this.isMentionPickerOpen.set(false);
    } catch (err: any) {
      console.error('Send failed:', err);
      this.sendError.set(err.message || 'Failed to send message.');
    }
  }

  formatLastSeen(timestamp?: number): string {
    if (!timestamp) return 'Offline';

    const date = new Date(timestamp);
    const now = new Date();

    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (isToday) {
      return `Last seen today at ${timeStr}`;
    } else if (isYesterday) {
      return `Last seen yesterday at ${timeStr}`;
    } else {
      const isSameYear = date.getFullYear() === now.getFullYear();
      const dateStr = date.toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        ...(isSameYear ? {} : { year: 'numeric' }),
      });
      return `Last seen on ${dateStr} at ${timeStr}`;
    }
  }

  async acceptRequest() {
    try {
      await this.conversationService.acceptMessageRequest();
    } catch (err) {
      console.error('Accept request failed:', err);
    }
  }

  onReplyTrigger(msg: Message) {
    this.replyingTo.set(msg);
  }

  cancelReply() {
    this.replyingTo.set(null);
  }

  getReplyMessage(replyToId: string | null | undefined): Message | null {
    if (!replyToId) return null;
    return this.messages().find((m) => m.id === replyToId) || null;
  }

  getReplySenderName(msg: Message | null): string {
    if (!msg) return '';
    if (msg.senderId === this.currentUserId()) return 'You';
    const user = this.userService.usersCache()[msg.senderId];
    return user?.displayName || user?.username || 'User';
  }

  goBack() {
    this.router.navigate(['/chats']);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.toggleSearch();
    } else if (event.key === 'Escape' && this.isSearchOpen()) {
      this.closeSearch();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;

    // Header 3-dot dropdown menu close check
    const isMenuBtn = target.closest('[title="Chat settings"]');
    const isMenuDropdown = target.closest('.header-menu-dropdown');
    if (!isMenuBtn && !isMenuDropdown) {
      this.isHeaderMenuOpen.set(false);
    }

    // Emoji picker close check
    const isEmojiBtn = target.closest('[title="Add emoji"]');
    const isEmojiPicker = target.closest('emoji-mart') || target.closest('.emoji-picker-container');
    if (!isEmojiBtn && !isEmojiPicker) {
      this.isEmojiPickerOpen.set(false);
    }
  }

  toggleSearch() {
    if (this.isSearchOpen()) {
      this.closeSearch();
    } else {
      this.isSearchOpen.set(true);
      this.isHeaderMenuOpen.set(false);
      queueMicrotask(() => {
        this.searchInput()?.nativeElement.focus();
      });
    }
  }

  closeSearch() {
    this.isSearchOpen.set(false);
    this.searchQuery.set('');
    this.currentMatchIndex.set(0);
    this.activeHighlightedMessageId.set(null);
  }

  onSearchEnter(event: Event) {
    const kbEvent = event as KeyboardEvent;
    if (kbEvent.shiftKey) {
      this.prevMatch();
    } else {
      this.nextMatch();
    }
  }

  nextMatch() {
    const matches = this.matchingMessages();
    if (matches.length === 0) return;
    const nextIdx = (this.currentMatchIndex() + 1) % matches.length;
    this.currentMatchIndex.set(nextIdx);
    this.scrollToMatch(matches[nextIdx].id);
  }

  prevMatch() {
    const matches = this.matchingMessages();
    if (matches.length === 0) return;
    const prevIdx = (this.currentMatchIndex() - 1 + matches.length) % matches.length;
    this.currentMatchIndex.set(prevIdx);
    this.scrollToMatch(matches[prevIdx].id);
  }

  scrollToMatch(messageId: string) {
    this.activeHighlightedMessageId.set(messageId);
    const el = document.getElementById('msg-' + messageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  toggleEmojiPicker(event: Event) {
    event.stopPropagation();
    this.isEmojiPickerOpen.set(!this.isEmojiPickerOpen());
  }

  addEmoji(event: any) {
    const emojiStr = event.emoji?.native;
    if (emojiStr) {
      this.text.set(this.text() + emojiStr);
    }
    // Clean queueMicrotask focus
    queueMicrotask(() => {
      this.messageInput()?.nativeElement.focus();
    });
  }

  toggleHeaderMenu(event: Event) {
    event.stopPropagation();
    this.isHeaderMenuOpen.set(!this.isHeaderMenuOpen());
  }

  openConfirm(action: 'clear' | 'delete') {
    this.isHeaderMenuOpen.set(false);
    this.activeConfirmAction.set(action);
  }

  closeConfirm() {
    this.activeConfirmAction.set(null);
  }

  async handleConfirm() {
    const action = this.activeConfirmAction();
    if (!action) return;

    this.isSubmittingConfirm.set(true);
    try {
      if (action === 'clear') {
        await this.conversationService.clearChatForMe();
      } else if (action === 'delete') {
        await this.conversationService.deleteConversationForMe();
      }
      this.closeConfirm();
    } catch (err: any) {
      console.error(`${action} failed:`, err);
      this.sendError.set(err.message || `Failed to ${action} chat.`);
    } finally {
      this.isSubmittingConfirm.set(false);
    }
  }
}
