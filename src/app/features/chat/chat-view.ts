import { Component, inject, computed, signal, ElementRef, viewChild, AfterViewInit, OnInit, OnDestroy, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Subscription } from 'rxjs';
import { ConversationService } from '../../services/conversation.service';
import { MessageService } from '../../services/message.service';
import { UserService } from '../../services/user.service';
import { Auth } from '../../core/auth';
import { MessageBubble } from './message-bubble';
import { Message } from '../../models/message.model';
import { AppUser } from '../../models/user.model';

@Component({
  selector: 'app-chat-view',
  imports: [FormsModule, MessageBubble, NgClass],
  templateUrl: './chat-view.html',
  styleUrl: './chat-view.scss',
})
export class ChatViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  
  readonly conversationService = inject(ConversationService);
  readonly messageService = inject(MessageService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth);

  readonly text = signal<string>('');
  readonly replyingTo = signal<Message | null>(null);

  private routeSub?: Subscription;
  private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');

  readonly currentUserId = computed(() => this.auth.currentUser()?.uid);
  readonly convo = computed(() => this.conversationService.selectedConversation());
  readonly messages = computed(() => this.messageService.activeMessages());

  // Check if DM is pending acceptance
  readonly isPending = computed(() => this.convo()?.isPending || false);
  readonly initiatedByMe = computed(() => this.convo()?.initiatedBy === this.currentUserId());
  
  // If it is pending and NOT initiated by current user, it is a message request banner
  readonly isMessageRequest = computed(() => this.isPending() && !this.initiatedByMe());

  // Get the chat partner profile for DMs
  readonly chatPartner = computed(() => {
    const activeConvo = this.convo();
    if (!activeConvo || activeConvo.type !== 'dm') return null;
    const partnerUid = activeConvo.participants.find((uid) => uid !== this.currentUserId());
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

  async send() {
    const messageText = this.text().trim();
    if (!messageText) return;

    try {
      await this.messageService.sendMessage(messageText, this.replyingTo()?.id);
      this.text.set('');
      this.replyingTo.set(null);
    } catch (err) {
      console.error('Send failed:', err);
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
}
