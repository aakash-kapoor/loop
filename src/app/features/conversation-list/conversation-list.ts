import { Component, inject, computed, Input } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
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
  @Input() isSidebar = false;

  private readonly conversationService = inject(ConversationService);
  private readonly router = inject(Router);

  private readonly routerEvents = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects || e.url)
    ),
    { initialValue: this.router.url }
  );

  readonly conversations = computed(() => this.conversationService.conversations());
  
  // Checks if the route is the empty "/chats" list path (which requires a placeholder on desktop)
  readonly isRouteChatsEmpty = computed(() => this.routerEvents() === '/chats');
}
