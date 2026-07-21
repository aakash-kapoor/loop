import { Routes } from '@angular/router';
import { authGuard } from './core/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login').then((m) => m.Login),
    canActivate: [authGuard],
  },
  {
    path: 'choose-username',
    loadComponent: () =>
      import('./features/choose-username/choose-username').then(
        (m) => m.ChooseUsername
      ),
    canActivate: [authGuard],
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./features/terms/terms').then((m) => m.TermsComponent),
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./features/privacy/privacy').then((m) => m.PrivacyComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./features/shell/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      {
        path: 'chats',
        loadComponent: () =>
          import('./features/conversation-list/conversation-list').then(
            (m) => m.ConversationList
          ),
      },
      {
        path: 'chats/:id',
        loadComponent: () =>
          import('./features/chat/chat-view').then((m) => m.ChatViewComponent),
      },
      {
        path: 'new',
        loadComponent: () =>
          import('./features/new-conversation/new-conversation').then(
            (m) => m.NewConversation
          ),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings').then((m) => m.Settings),
      },
      {
        path: '',
        redirectTo: 'chats',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
