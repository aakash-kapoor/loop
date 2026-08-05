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
import { Message, MessageAttachment } from '../../models/message.model';
import { AppUser } from '../../models/user.model';
import { Conversation } from '../../models/conversation.model';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import { fileToCompressedDataUrl, formatBytes, MAX_FILE_SIZE_BYTES } from '../../shared/utils/image-compressor';

import { GroupInfoModal } from './group-info-modal/group-info-modal';
import { ConfirmModal } from '../../shared/confirm-modal/confirm-modal';
import { ForwardModal } from '../../shared/forward-modal/forward-modal';

export interface UploadingAttachmentItem {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  mimeType: string;
  isImage: boolean;
  previewUrl?: string;
  progress: number;
  status: 'compressing' | 'uploading' | 'completed' | 'error';
  error?: string;
  resultAttachment?: MessageAttachment;
}

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
  private readonly userService = inject(UserService);
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

  // File Attachment & Upload State Signals
  readonly uploadingFiles = signal<UploadingAttachmentItem[]>([]);
  readonly activeLightboxImage = signal<string | null>(null);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly forwardModalRef = viewChild<ForwardModal>('forwardModal');

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

  private routeSub?: Subscription;
  private themeObserver?: MutationObserver;
  private typingDebounceTimer?: ReturnType<typeof setTimeout>;
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

  readonly chatPartnerOnline = computed(() => this.userService.isUserOnline(this.chatPartner()));

  readonly fetchedPinnedMessage = signal<Message | null>(null);

  /** 
   * Pinned message object derived from activeMessages stream or fetched by ID fallback
   */
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

  /**
   * Typing indicator label for the chat header.
   */
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

  /** User profile of the primary typing participant. */
  readonly typingUser = computed(() => {
    const convoId = this.convo()?.id;
    if (!convoId) return null;

    const uids = this.conversationService.typingUsers(convoId).filter((uid) => uid !== this.currentUserId());
    if (uids.length === 0) return null;

    const cache = this.userService.usersCache();
    return cache[uids[0]] || null;
  });

  private previousMessageCount = 0;
  private previousConvoId: string | null = null;
  private isInitialLoadPhase = false;
  private initialLoadTimer?: ReturnType<typeof setTimeout>;
  private highlightTimeout?: ReturnType<typeof setTimeout>;

  constructor() {
    // Reactive effect to fetch pinned message by ID fallback if older than loaded messages stream
    effect(() => {
      const convoId = this.convo()?.id;
      const pinnedId = this.convo()?.pinnedMessageId;
      const msgs = this.messages();

      if (!convoId || !pinnedId) {
        this.fetchedPinnedMessage.set(null);
        return;
      }

      // Check if message is already in active stream
      const inStream = msgs.find((m) => m.id === pinnedId);
      if (inStream) {
        this.fetchedPinnedMessage.set(null);
        return;
      }

      // If not in active stream and not already fetched, fetch by ID
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

    // Auto-scroll to bottom ONLY when switching conversations or when a new message arrives
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
          // If conversation has 0 messages, show empty chat placeholder immediately
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
        this.currentMatchIndex.set(0);
        const firstMatchId = matches[0].id;
        setTimeout(() => this.scrollToMatch(firstMatchId), 50);
      } else {
        this.activeHighlightedMessageId.set(null);
      }
    });

    // Mark incoming messages as seen whenever messages change and the tab is visible
    effect(() => {
      const msgs = this.messages();
      const convoId = this.convo()?.id;
      if (convoId && msgs.length > 0 && !document.hidden) {
        this.messageService.markMessagesAsSeen(convoId, msgs);
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
    clearTimeout(this.typingDebounceTimer);
    clearTimeout(this.highlightTimeout);
    clearTimeout(this.initialLoadTimer);
    // Clear typing indicator immediately when leaving the chat
    const convoId = this.convo()?.id;
    if (convoId) {
      this.conversationService.clearTyping(convoId);
    }
    // Deselect conversation on destroy
    this.conversationService.selectConversation(null);
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
    // — Typing indicator heartbeat —
    if (convoId) {
      this.conversationService.setTyping(convoId);
      clearTimeout(this.typingDebounceTimer);
      this.typingDebounceTimer = setTimeout(() => {
        this.conversationService.clearTyping(convoId);
      }, 3_000);
    }

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

  formatFileSize(bytes: number): string {
    return formatBytes(bytes);
  }

  triggerFileInput() {
    this.fileInput()?.nativeElement.click();
  }

  async onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const convo = this.convo();
    if (!convo) return;

    const selectedFiles = Array.from(input.files);
    // Reset file input value so re-selecting same files triggers change event
    input.value = '';

    for (const file of selectedFiles) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        this.sendError.set(`"${file.name}" exceeds the 500 KB limit for free tier (${formatBytes(file.size)}).`);
        continue;
      }

      const isImg = file.type.startsWith('image/') && !file.type.includes('svg');
      const itemId = Math.random().toString(36).substring(2, 9);

      let previewUrl: string | undefined;
      if (isImg) {
        previewUrl = URL.createObjectURL(file);
      }

      const newItem: UploadingAttachmentItem = {
        id: itemId,
        file,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        isImage: isImg,
        previewUrl,
        progress: 0,
        status: isImg ? 'compressing' : 'uploading',
      };

      this.uploadingFiles.update((list) => [...list, newItem]);

      this.processAndUploadFile(newItem);
    }
  }

  private async processAndUploadFile(item: UploadingAttachmentItem) {
    try {
      const { dataUrl, finalSize } = await fileToCompressedDataUrl(item.file, (percent) => {
        this.uploadingFiles.update((list) =>
          list.map((i) => (i.id === item.id ? { ...i, progress: percent } : i))
        );
      });

      const fileExt = item.fileName.includes('.') ? item.fileName.split('.').pop()?.toLowerCase() || '' : '';
      let fileType: MessageAttachment['fileType'] = 'other';
      if (item.mimeType.startsWith('image/')) fileType = 'image';
      else if (item.mimeType.startsWith('video/')) fileType = 'video';
      else if (item.mimeType.startsWith('audio/')) fileType = 'audio';
      else if (
        item.mimeType.includes('pdf') ||
        item.mimeType.includes('word') ||
        item.mimeType.includes('document') ||
        item.mimeType.includes('sheet') ||
        item.mimeType.includes('presentation') ||
        item.mimeType.includes('text') ||
        ['pdf', 'doc', 'docx', 'txt', 'zip', 'rar', 'csv', 'xlsx', 'pptx'].includes(fileExt)
      ) {
        fileType = 'document';
      }

      const attachment: MessageAttachment = {
        url: dataUrl,
        fileName: item.fileName,
        fileSize: finalSize || item.fileSize,
        fileType,
        mimeType: item.mimeType || 'application/octet-stream',
      };

      this.uploadingFiles.update((list) =>
        list.map((i) =>
          i.id === item.id
            ? { ...i, progress: 100, status: 'completed', resultAttachment: attachment, fileSize: finalSize }
            : i
        )
      );
    } catch (err: any) {
      console.error('File processing failed:', err);
      this.uploadingFiles.update((list) =>
        list.map((i) =>
          i.id === item.id ? { ...i, status: 'error', error: err.message || 'Processing failed' } : i
        )
      );
    }
  }

  removeAttachment(id: string) {
    const item = this.uploadingFiles().find((i) => i.id === id);
    if (item && item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
    this.uploadingFiles.update((list) => list.filter((i) => i.id !== id));
  }

  readonly isUploadingAny = computed(() =>
    this.uploadingFiles().some((i) => i.status === 'compressing' || i.status === 'uploading')
  );

  readonly hasCompletedAttachments = computed(() =>
    this.uploadingFiles().some((i) => i.status === 'completed' && i.resultAttachment)
  );

  async send() {
    const messageText = this.text().trim();
    const completedItems = this.uploadingFiles().filter(
      (i) => i.status === 'completed' && i.resultAttachment
    );
    const attachments = completedItems.map((i) => i.resultAttachment!);

    if (!messageText && attachments.length === 0) return;
    if (this.isUploadingAny()) return; // Block sending while uploads in progress

    // Filter mentionedUids to ensure the mention text is still present in the final message
    const activeParticipants = this.groupParticipantsForMention();
    const validMentionUids = this.mentionedUids().filter((uid) => {
      if (uid === 'all') return messageText.includes('@all');
      const p = activeParticipants.find((item) => item.uid === uid);
      if (!p) return messageText.includes('@');
      const firstName = p.name.split(' ')[0];
      return messageText.includes(`@${firstName}`) || (p.username && messageText.includes(`@${p.username}`));
    });

    this.sendError.set(null);
    // Clear typing indicator immediately — don't wait for the 3 s debounce
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
      this.replyingTo.set(null);
      this.mentionedUids.set([]);
      this.isMentionPickerOpen.set(false);

      // Clean up uploaded files list and preview URLs
      this.uploadingFiles().forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      this.uploadingFiles.set([]);
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
    clearTimeout(this.highlightTimeout);
    this.activeHighlightedMessageId.set(null);
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
      // Auto-close modal after showing success confirmation
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
    clearTimeout(this.highlightTimeout);
    this.activeHighlightedMessageId.set(messageId);
    const el = document.getElementById('msg-' + messageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    this.highlightTimeout = setTimeout(() => {
      if (this.activeHighlightedMessageId() === messageId) {
        this.activeHighlightedMessageId.set(null);
      }
    }, 2500);
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
