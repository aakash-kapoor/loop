import { Component, inject, computed, signal, Input } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConversationService } from '../../services/conversation.service';
import { UserService } from '../../services/user.service';
import { Auth } from '../../core/auth';
import { Conversation } from '../../models/conversation.model';
import { ConversationItem } from './conversation-item/conversation-item';

@Component({
  selector: 'app-conversation-list',
  imports: [RouterLink, ConversationItem, NgTemplateOutlet, NgClass, FormsModule],
  templateUrl: './conversation-list.html',
  styleUrl: './conversation-list.scss',
  host: {
    class: 'block h-full w-full min-h-0 overflow-hidden',
  },
})
export class ConversationList {
  @Input() isSidebar = false;

  private readonly conversationService = inject(ConversationService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly searchQuery = signal<string>('');
  readonly activeCategory = signal<'all' | 'unread' | 'groups'>('all');

  private readonly routerEvents = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects || e.url)
    ),
    { initialValue: this.router.url }
  );

  readonly conversations = this.conversationService.conversations;

  private getUnreadCount(convo: Conversation): number {
    const currentUid = this.auth.currentUser()?.uid;
    if (!currentUid || !convo.unreadCount) return 0;
    return convo.unreadCount[currentUid] || 0;
  }

  // Unread conversation count
  readonly unreadTotalCount = computed(() => {
    return this.conversations().filter(c => this.getUnreadCount(c) > 0).length;
  });

  // Groups conversation count
  readonly groupsTotalCount = computed(() => {
    return this.conversations().filter(c => c.type === 'group').length;
  });

  // Reactively filtered conversations
  readonly filteredConversations = computed(() => {
    const list = this.conversations();
    const queryStr = this.searchQuery().trim().toLowerCase();
    const category = this.activeCategory();
    const currentUid = this.auth.currentUser()?.uid;
    const usersMap = this.userService.usersCache();

    return list.filter((convo) => {
      // Category filter
      if (category === 'unread' && this.getUnreadCount(convo) <= 0) {
        return false;
      }
      if (category === 'groups' && convo.type !== 'group') {
        return false;
      }

      // Search query filter
      if (!queryStr) return true;

      if (convo.type === 'group') {
        const groupName = (convo.groupName || '').toLowerCase();
        const lastMsg = (convo.lastMessage || '').toLowerCase();
        return groupName.includes(queryStr) || lastMsg.includes(queryStr);
      } else {
        const otherUid = convo.participants.find(u => u !== currentUid);
        const profile = otherUid ? usersMap[otherUid] : null;
        const displayName = (profile?.displayName || '').toLowerCase();
        const username = (profile?.username || '').toLowerCase();
        const lastMsg = (convo.lastMessage || '').toLowerCase();

        return displayName.includes(queryStr) || username.includes(queryStr) || lastMsg.includes(queryStr);
      }
    });
  });

  clearSearch() {
    this.searchQuery.set('');
  }

  setCategory(cat: 'all' | 'unread' | 'groups') {
    this.activeCategory.set(cat);
  }

  // Checks if the route is the empty "/chats" list path (which requires a placeholder on desktop)
  readonly isRouteChatsEmpty = computed(() => this.routerEvents() === '/chats');
}
