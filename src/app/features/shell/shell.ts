import { Component, inject, computed } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ConversationList } from '../conversation-list/conversation-list';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConversationList],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly router = inject(Router);

  // Bottom navigation is hidden on mobile if in a chat view (/chats/XYZ)
  readonly isChatActive = computed(() => {
    return this.router.url.includes('/chats/') && !this.router.url.endsWith('/chats');
  });
}
