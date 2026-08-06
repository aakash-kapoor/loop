import { Component, inject, computed, signal, ElementRef, viewChild, OnInit, OnDestroy, effect, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Subscription } from 'rxjs';
import { ConversationService } from '../../services/conversation.service';
import { MessageService } from '../../services/message.service';
import { UserService } from '../../services/user.service';
import { DraftService } from '../../services/draft.service';
import { AttachmentUploadService, UploadingAttachmentItem } from '../../services/attachment-upload.service';
import { ChatSearchService } from '../../services/chat-search.service';
import { MentionService, MentionCandidate } from '../../services/mention.service';
import { Auth } from '../../core/auth';
import { MessageBubble } from './message-bubble';
import { Avatar } from '../../shared/avatar/avatar';
import { Message } from '../../models/message.model';
import { Conversation, isConvoMuted } from '../../models/conversation.model';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import { formatBytes } from '../../shared/utils/image-compressor';

import { GroupInfoModal } from './group-info-modal/group-info-modal';
import { ConfirmModal } from '../../shared/confirm-modal/confirm-modal';
import { ForwardModal } from '../../shared/forward-modal/forward-modal';

@Component({
  selector: 'app-chat-view',
  imports: [FormsModule, MessageBubble, NgClass, Avatar, PickerComponent, GroupInfoModal, ConfirmModal, ForwardModal],
  templateUrl: './chat-view.html',
  styleUrl: './chat-view.scss',
  host: {
    class: 'block h-full w-full min-h-0 overflow-hidden',
  },
})
export class ChatViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly elementRef = inject(ElementRef);

  readonly conversationService = inject(ConversationService);
  readonly messageService = inject(MessageService);
  readonly attachmentService = inject(AttachmentUploadService);
  readonly chatSearchService = inject(ChatSearchService);
  readonly mentionService = inject(MentionService);

  private readonly userService = inject(UserService);
  private readonly draftService = inject(DraftService);
  private readonly auth = inject(Auth);

  readonly text = signal<string>('');
  readonly replyingTo = signal<Message | null>(null);
  readonly forwardingMessage = signal<Message | null>(null);
  readonly isHeaderMenuOpen = signal<boolean>(false);
  readonly isGroupInfoOpen = signal<boolean>(false);
  readonly activeConfirmAction = signal<'clear' | 'delete' | null>(null);
  readonly isSubmittingConfirm = signal<boolean>(false);
  readonly isEmojiPickerOpen = signal<boolean>(false);
  readonly isDarkTheme = signal<boolean>(false);
  readonly sendError = signal<string | null>(null);
  readonly messagesVisible = signal<boolean>(false);
  readonly isScrolledUp = signal<boolean>(false);
  readonly isMuteSubmenuOpen = signal<boolean>(false);
  readonly activeLightboxImage = signal<string | null>(null);
  readonly fetchedPinnedMessage = signal<Message | null>(null);

  // Delegated signals from domain services
  readonly uploadingFiles = this.attachmentService.uploadingFiles;
  readonly isUploadingAny = this.attachmentService.isUploadingAny;
  readonly hasCompletedAttachments = this.attachmentService.hasCompletedAttachments;

  readonly isSearchOpen = this.chatSearchService.isSearchOpen;
  readonly searchQuery = this.chatSearchService.searchQuery;
  readonly currentMatchIndex = this.chatSearchService.currentMatchIndex;
  readonly activeHighlightedMessageId = this.chatSearchService.activeHighlightedMessageId;

  readonly isMentionPickerOpen = this.mentionService.isMentionPickerOpen;
  readonly mentionQuery = this.mentionService.mentionQuery;
  readonly mentionSelectedIndex = this.mentionService.mentionSelectedIndex;
  readonly mentionedUids = this.mentionService.mentionedUids;

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly forwardModalRef = viewChild<ForwardModal>('forwardModal');
  private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');
  private readonly messageInput = viewChild<ElementRef<HTMLInputElement>>('messageInput');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  private routeSub?: Subscription;
  private themeObserver?: MutationObserver;
  private typingDebounceTimer?: ReturnType<typeof setTimeout>;
  private draftSaveTimer?: ReturnType<typeof setTimeout>;
  private activeConvoId: string | null = null;

  private previousMessageCount = 0;
  private previousConvoId: string | null = null;
  private isInitialLoadPhase = false;
  private initialLoadTimer?: ReturnType<typeof setTimeout>;

  readonly currentUserId = computed(() => this.auth.currentUser()?.uid);
  readonly convo = computed(() => this.conversationService.selectedConversation());
  readonly messages = computed(() => this.messageService.activeMessages());

  readonly groupParticipantsForMention = computed(() =>
    this.mentionService.getGroupParticipantsForMention(
      this.convo(),
      this.currentUserId(),
      this.userService.usersCache()
    )
  );

  readonly matchingMessages = computed(() =>
    this.chatSearchService.getMatchingMessages(this.messages(), this.currentUserId())
  );

  readonly currentMatch = computed(() =>
    this.chatSearchService.getCurrentMatch(this.matchingMessages())
  );

  readonly isAdmin = computed(() => {
    const c = this.convo();
    const uid = this.currentUserId();
    if (!c || !uid) return false;
    return c.type === 'group' && c.admins?.includes(uid);
  });

  readonly isMuted = computed(() => {
    const c = this.convo();
    const uid = this.currentUserId();
    return isConvoMuted(c, uid);
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

  readonly chatPartnerOnline = computed(() => this.userService.isUserOnline(this.chatPartner()));

  /** Pinned message object derived from activeMessages stream or fetched by ID fallback */
  readonly pinnedMessage = computed(() => {
    const pinnedId = this.convo()?.pinnedMessageId;
    if (!pinnedId) return null;
    const msg = this.messages().find((m) => m.id === pinnedId) || this.fetchedPinnedMessage();
    if (!msg || msg.id !== pinnedId || msg.deletedForEveryone || msg.deletedFor?.includes(this.currentUserId() || '')) {
      return null;
    }
    return msg;
  });

  /** Display name of the pinned message sender */
  readonly pinnedSenderName = computed(() => {
    const msg = this.pinnedMessage();
    if (!msg) return '';
    if (msg.senderId === this.currentUserId()) return 'You';
    const user = this.userService.usersCache()[msg.senderId];
    return user?.displayName || user?.username || 'User';
  });

  /** Typing indicator label for the chat header */
  readonly typingLabel = computed<string | null>(() => {
    const convoId = this.convo()?.id;
    if (!convoId) return null;

    const uids = this.conversationService.typingUsers(convoId);
    const otherUids = uids.filter((uid) => uid !== this.currentUserId());
    if (otherUids.length === 0) return null;

    const names = otherUids.map((uid) => {
      const u = this.userService.usersCache()[uid];
      return u?.displayName || u?.username || 'Someone';
    });

    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names[0]} and ${names.length - 1} others are typing…`;
  });

  /** User profile of the primary typing participant */
  readonly typingUser = computed(() => {
    const convoId = this.convo()?.id;
    if (!convoId) return null;

    const uids = this.conversationService.typingUsers(convoId).filter((uid) => uid !== this.currentUserId());
    if (uids.length === 0) return null;

    const cache = this.userService.usersCache();
    return cache[uids[0]] || null;
  });

  constructor() {
    // Fetch pinned message by ID fallback if older than loaded messages stream
    effect(() => {
      const convoId = this.convo()?.id;
      const pinnedId = this.convo()?.pinnedMessageId;
      const msgs = this.messages();

      if (!convoId || !pinnedId) {
        this.fetchedPinnedMessage.set(null);
        return;
      }

      const inStream = msgs.find((m) => m.id === pinnedId);
      if (inStream) {
        this.fetchedPinnedMessage.set(null);
        return;
      }

      if (this.fetchedPinnedMessage()?.id !== pinnedId) {
        this.messageService.getMessageById(convoId, pinnedId).then((fetchedMsg) => {
          if (fetchedMsg) {
            this.fetchedPinnedMessage.set(fetchedMsg);
            if (fetchedMsg.senderId) {
              this.userService.fetchParticipantProfiles([fetchedMsg.senderId]);
            }
          }
        });
      }
    });

    // Auto-scroll logic when conversation changes or messages arrive
    effect(() => {
      const msgs = this.messages();
      const currentConvoId = this.convo()?.id || null;

      if (!currentConvoId) {
        this.previousMessageCount = 0;
        this.previousConvoId = null;
        this.isInitialLoadPhase = false;
        clearTimeout(this.initialLoadTimer);
        this.messagesVisible.set(false);
        return;
      }

      const isDifferentConvo = currentConvoId !== this.previousConvoId;
      if (isDifferentConvo) {
        this.previousConvoId = currentConvoId;
        this.previousMessageCount = 0;
        this.isInitialLoadPhase = true;
        this.messagesVisible.set(false);

        clearTimeout(this.initialLoadTimer);
        this.initialLoadTimer = setTimeout(() => {
          this.isInitialLoadPhase = false;
        }, 400);
      }

      if (this.isInitialLoadPhase) {
        if (msgs.length > 0) {
          this.previousMessageCount = msgs.length;
          if (!this.searchQuery().trim()) {
            setTimeout(() => {
              this.scrollToBottom(true);
              this.messagesVisible.set(true);
            }, 80);
          } else {
            this.messagesVisible.set(true);
          }
        } else {
          this.messagesVisible.set(true);
        }
        return;
      }

      const isNewMessageAdded = msgs.length > this.previousMessageCount;
      if (isNewMessageAdded && !this.searchQuery().trim()) {
        setTimeout(() => this.scrollToBottom(), 30);
      }

      this.previousMessageCount = msgs.length;
      this.messagesVisible.set(true);
    });

    // Reset match index and scroll to first match when searchQuery changes
    effect(() => {
      const matches = this.matchingMessages();
      if (matches.length > 0) {
        this.chatSearchService.currentMatchIndex.set(0);
        const firstMatchId = matches[0].id;
        setTimeout(() => this.scrollToMatch(firstMatchId), 50);
      } else {
        this.chatSearchService.activeHighlightedMessageId.set(null);
      }
    });

    // Mark incoming messages as seen
    effect(() => {
      const msgs = this.messages();
      const convoId = this.convo()?.id;
      if (convoId && msgs.length > 0 && !document.hidden) {
        this.messageService.markMessagesAsSeen(convoId, msgs);
      }
    });

    // Debounced draft persistence effect
    effect(() => {
      const convoId = this.convo()?.id;
      const currentText = this.text();

      if (!convoId) return;

      clearTimeout(this.draftSaveTimer);
      this.draftSaveTimer = setTimeout(() => {
        if (this.activeConvoId === convoId) {
          this.draftService.saveDraft(convoId, currentText);
        }
      }, 300);
    });
  }

  ngOnInit() {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id');

      const prevId = this.activeConvoId;
      if (prevId && prevId !== id) {
        clearTimeout(this.draftSaveTimer);
        this.draftService.saveDraft(prevId, this.text());
      }

      this.activeConvoId = id;
      this.conversationService.selectConversation(id);
      this.replyingTo.set(null);

      const restoredDraft = id ? this.draftService.getDraft(id) : '';
      this.text.set(restoredDraft);

      this.isEmojiPickerOpen.set(false);
      this.sendError.set(null);
      this.closeSearch();
      this.attachmentService.clear();
      this.mentionService.clear();
    });

    this.isDarkTheme.set(document.documentElement.classList.contains('dark'));
    this.themeObserver = new MutationObserver(() => {
      this.isDarkTheme.set(document.documentElement.classList.contains('dark'));
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
    this.themeObserver?.disconnect();
    clearTimeout(this.typingDebounceTimer);
    clearTimeout(this.initialLoadTimer);
    clearTimeout(this.draftSaveTimer);
    this.chatSearchService.clearHighlightTimeout();

    if (this.activeConvoId) {
      this.draftService.saveDraft(this.activeConvoId, this.text());
    }

    const convoId = this.convo()?.id;
    if (convoId) {
      this.conversationService.clearTyping(convoId);
    }
    this.conversationService.selectConversation(null);
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.activeLightboxImage()) {
      this.closeLightbox();
    }
  }

  openLightbox(url: string) {
    this.activeLightboxImage.set(url);
  }

  closeLightbox() {
    this.activeLightboxImage.set(null);
  }

  scrollToBottom(instant = false) {
    const el = this.messagesContainer()?.nativeElement;
    if (!el) return;

    el.style.scrollBehavior = instant ? 'auto' : 'smooth';
    el.scrollTop = el.scrollHeight;
    this.isScrolledUp.set(false);
  }

  onMessagesScroll(event: Event) {
    const el = event.target as HTMLElement;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.isScrolledUp.set(distanceFromBottom > 120);
  }

  onTextInput() {
    const convoId = this.convo()?.id;
    if (convoId) {
      this.conversationService.setTyping(convoId);
      clearTimeout(this.typingDebounceTimer);
      this.typingDebounceTimer = setTimeout(() => {
        this.conversationService.clearTyping(convoId);
      }, 3_000);
    }

    const inputEl = this.messageInput()?.nativeElement;
    const isGroup = this.convo()?.type === 'group';
    const val = this.text();
    const cursorPos = inputEl?.selectionStart ?? val.length;

    this.mentionService.handleTextInput(val, cursorPos, isGroup);
  }

  selectMention(candidate: MentionCandidate) {
    const inputEl = this.messageInput()?.nativeElement;
    const val = this.text();
    const updatedText = this.mentionService.selectMention(candidate, val, inputEl);
    this.text.set(updatedText);
  }

  onInputKeydown(event: KeyboardEvent) {
    const candidates = this.groupParticipantsForMention();
    const handled = this.mentionService.handleKeydown(event, candidates, (c) => this.selectMention(c));
    if (handled) return;

    if (event.key === 'Enter') {
      this.send();
    }
  }

  formatFileSize(bytes: number): string {
    return formatBytes(bytes);
  }

  triggerFileInput() {
    this.fileInput()?.nativeElement.click();
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const convo = this.convo();
    if (!convo) return;

    const selectedFiles = Array.from(input.files);
    input.value = '';

    const err = this.attachmentService.processFiles(selectedFiles);
    if (err) {
      this.sendError.set(err);
    }
  }

  removeAttachment(id: string) {
    this.attachmentService.removeAttachment(id);
  }

  async send() {
    const messageText = this.text().trim();
    const attachments = this.attachmentService.getCompletedAttachments();

    if (!messageText && attachments.length === 0) return;
    if (this.isUploadingAny()) return;

    const activeParticipants = this.groupParticipantsForMention();
    const validMentionUids = this.mentionService.filterValidMentions(messageText, activeParticipants);

    this.sendError.set(null);
    const convoId = this.convo()?.id;
    if (convoId) {
      clearTimeout(this.typingDebounceTimer);
      this.conversationService.clearTyping(convoId);
    }
    try {
      await this.messageService.sendMessage(
        messageText,
        this.replyingTo()?.id,
        validMentionUids,
        attachments.length > 0 ? attachments : undefined
      );
      this.text.set('');
      if (convoId) {
        this.draftService.clearDraft(convoId);
      }
      this.replyingTo.set(null);
      this.mentionService.clear();
      this.attachmentService.clear();
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

  async pinMessage(msg: Message) {
    const convoId = this.convo()?.id;
    if (!convoId) return;
    try {
      await this.conversationService.pinMessage(convoId, msg.id);
    } catch (err: any) {
      console.error('Failed to pin message:', err);
      this.sendError.set(err.message || 'Failed to pin message');
    }
  }

  async unpinMessage() {
    this.chatSearchService.clearHighlightTimeout();
    this.chatSearchService.activeHighlightedMessageId.set(null);
    const convoId = this.convo()?.id;
    if (!convoId) return;
    try {
      await this.conversationService.pinMessage(convoId, null);
    } catch (err: any) {
      console.error('Failed to unpin message:', err);
      this.sendError.set(err.message || 'Failed to unpin message');
    }
  }

  jumpToPinnedMessage() {
    const pinned = this.pinnedMessage();
    if (pinned) {
      this.scrollToMatch(pinned.id);
    }
  }

  onForwardTrigger(msg: Message) {
    this.forwardingMessage.set(msg);
  }

  onForwardClose() {
    this.forwardingMessage.set(null);
  }

  async onForwardConfirm(targetConvo: Conversation) {
    const msg = this.forwardingMessage();
    if (!msg) return;

    try {
      await this.messageService.forwardMessage(msg, targetConvo.id);
      this.forwardModalRef()?.markSuccess();
      setTimeout(() => this.forwardingMessage.set(null), 1200);
    } catch (err: any) {
      console.error('Forward failed:', err);
      this.forwardModalRef()?.markError(err.message || 'Failed to forward message.');
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

    const isMenuBtn = target.closest('[title="Chat settings"]');
    const isMenuDropdown = target.closest('.header-menu-dropdown');
    if (!isMenuBtn && !isMenuDropdown) {
      this.isHeaderMenuOpen.set(false);
    }

    const isEmojiBtn = target.closest('[title="Add emoji"]');
    const isEmojiPicker = target.closest('emoji-mart') || target.closest('.emoji-picker-container');
    if (!isEmojiBtn && !isEmojiPicker) {
      this.isEmojiPickerOpen.set(false);
    }
  }

  toggleSearch() {
    this.chatSearchService.toggleSearch(() => {
      this.isHeaderMenuOpen.set(false);
      this.searchInput()?.nativeElement.focus();
    });
  }

  closeSearch() {
    this.chatSearchService.closeSearch();
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
    this.chatSearchService.nextMatch(this.matchingMessages(), (id) => this.scrollToMatch(id));
  }

  prevMatch() {
    this.chatSearchService.prevMatch(this.matchingMessages(), (id) => this.scrollToMatch(id));
  }

  scrollToMatch(messageId: string) {
    this.chatSearchService.highlightAndScrollTo(messageId, (id) => {
      const el = document.getElementById('msg-' + id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
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
    queueMicrotask(() => {
      this.messageInput()?.nativeElement.focus();
    });
  }

  toggleHeaderMenu(event: Event) {
    event.stopPropagation();
    this.isHeaderMenuOpen.set(!this.isHeaderMenuOpen());
    this.isMuteSubmenuOpen.set(false);
  }

  toggleMuteSubmenu(event: Event) {
    event.stopPropagation();
    this.isMuteSubmenuOpen.set(!this.isMuteSubmenuOpen());
  }

  async mute(durationMs: number | -1) {
    const convoId = this.convo()?.id;
    if (!convoId) return;
    this.isHeaderMenuOpen.set(false);
    this.isMuteSubmenuOpen.set(false);
    try {
      await this.conversationService.muteConversation(convoId, durationMs);
    } catch (err: any) {
      console.error('Mute failed:', err);
      this.sendError.set(err.message || 'Failed to mute conversation.');
    }
  }

  async unmute() {
    const convoId = this.convo()?.id;
    if (!convoId) return;
    this.isHeaderMenuOpen.set(false);
    this.isMuteSubmenuOpen.set(false);
    try {
      await this.conversationService.unmuteConversation(convoId);
    } catch (err: any) {
      console.error('Unmute failed:', err);
      this.sendError.set(err.message || 'Failed to unmute conversation.');
    }
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
    const convoId = this.convo()?.id;
    if (!action) return;

    this.isSubmittingConfirm.set(true);
    try {
      if (action === 'clear') {
        await this.conversationService.clearChatForMe();
      } else if (action === 'delete') {
        await this.conversationService.deleteConversationForMe();
      }
      if (convoId) {
        this.draftService.clearDraft(convoId);
      }
      this.text.set('');
      this.closeConfirm();
    } catch (err: any) {
      console.error(`${action} failed:`, err);
      this.sendError.set(err.message || `Failed to ${action} chat.`);
    } finally {
      this.isSubmittingConfirm.set(false);
    }
  }
}
