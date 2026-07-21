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

  private routeSub?: Subscription;
  private themeObserver?: MutationObserver;
  private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');
  private readonly messageInput = viewChild<ElementRef<HTMLInputElement>>('messageInput');

  readonly currentUserId = computed(() => this.auth.currentUser()?.uid);
  readonly convo = computed(() => this.conversationService.selectedConversation());
  readonly messages = computed(() => this.messageService.activeMessages());

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
    // Auto-scroll to bottom when new messages arrive
    effect(() => {
      const msgs = this.messages();
      if (msgs.length > 0) {
        setTimeout(() => this.scrollToBottom(), 30);
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

  readonly sendError = signal<string | null>(null);

  async send() {
    const messageText = this.text().trim();
    if (!messageText) return;

    this.sendError.set(null);
    try {
      await this.messageService.sendMessage(messageText, this.replyingTo()?.id);
      this.text.set('');
      this.replyingTo.set(null);
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
