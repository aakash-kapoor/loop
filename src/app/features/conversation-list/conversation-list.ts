import { Component, inject, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { ConversationService } from '../../services/conversation.service';
import { ConversationItem } from './conversation-item/conversation-item';

@Component({
  selector: 'app-conversation-list',
  imports: [RouterLink, ConversationItem, NgTemplateOutlet],
  templateUrl: './conversation-list.html',
  styleUrl: './conversation-list.scss',
})
export class ConversationList {
  private readonly conversationService = inject(ConversationService);
  private readonly router = inject(Router);

  readonly conversations = computed(() => this.conversationService.conversations());
  
  // Checks if the route is the empty "/chats" list path (which requires a placeholder on desktop)
  readonly isRouteChatsEmpty = computed(() => this.router.url === '/chats');
}
