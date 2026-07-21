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

@Component({
  selector: 'app-chat-view',
  imports: [FormsModule, MessageBubble, NgClass, Avatar, PickerComponent],
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
  readonly isConfirmingDelete = signal<boolean>(false);
  readonly isConfirmingDeleteForEveryone = signal<boolean>(false);
  readonly isEmojiPickerOpen = signal<boolean>(false);

  private routeSub?: Subscription;
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
    });
  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
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

  goBack() {
    this.router.navigate(['/chats']);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const inside = this.elementRef.nativeElement.contains(event.target as Node);
    if (!inside) {
      this.isHeaderMenuOpen.set(false);
      this.isConfirmingDelete.set(false); // reset confirm state when closing
      this.isConfirmingDeleteForEveryone.set(false);
      this.isEmojiPickerOpen.set(false);
    } else {
      const target = event.target as HTMLElement;
      const isEmojiBtn = target.closest('[title="Add emoji"]');
      const isEmojiPicker = target.closest('emoji-mart') || target.closest('.emoji-picker-container');
      if (!isEmojiBtn && !isEmojiPicker) {
        this.isEmojiPickerOpen.set(false);
      }
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
    // Focus back to input immediately for continuous typing
    setTimeout(() => {
      this.messageInput()?.nativeElement.focus();
    }, 10);
  }

  toggleHeaderMenu(event: Event) {
    event.stopPropagation();
    this.isHeaderMenuOpen.set(!this.isHeaderMenuOpen());
  }

  isDarkTheme(): boolean {
    return document.documentElement.classList.contains('dark');
  }

  async clearChat() {
    this.isHeaderMenuOpen.set(false);
    try {
      await this.conversationService.clearChatForMe();
    } catch (err) {
      console.error('Clear chat failed:', err);
    }
  }

  async deleteConversation() {
    if (!this.isConfirmingDelete()) {
      this.isConfirmingDelete.set(true);
      return;
    }
    // Second click — confirmed
    this.isConfirmingDelete.set(false);
    this.isHeaderMenuOpen.set(false);
    try {
      await this.conversationService.deleteConversationForMe();
    } catch (err) {
      console.error('Delete conversation failed:', err);
    }
  }

  async deleteGroupForEveryone() {
    const activeConvo = this.convo();
    if (!activeConvo) return;

    if (!this.isConfirmingDeleteForEveryone()) {
      this.isConfirmingDeleteForEveryone.set(true);
      return;
    }

    // Second click — confirmed
    this.isConfirmingDeleteForEveryone.set(false);
    this.isHeaderMenuOpen.set(false);
    try {
      await this.conversationService.deleteGroupForEveryone(activeConvo.id);
    } catch (err) {
      console.error('Delete group failed:', err);
    }
  }
}
