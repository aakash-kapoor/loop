import { Component, inject, computed, effect } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly authService = inject(Auth);
  private readonly router = inject(Router);

  // App is loading while the initial authentication state is unresolved (undefined)
  readonly isLoading = computed(() => this.authService.currentUser() === undefined);

  constructor() {
    // Global Routing Coordinator: reactively moves user based on auth profile changes
    effect(() => {
      const user = this.authService.currentUser();
      if (user === undefined) return; // Wait for initial session fetch

      // Use window.location.pathname to inspect the browser's actual route path.
      // This prevents Angular's initial startup "/" state from overriding targeted chat URLs.
      const currentPath = window.location.pathname;

      if (!user) {
        // If not logged in, redirect to login page
        if (currentPath !== '/login') {
          this.router.navigate(['/login']);
        }
      } else if (!user.username) {
        // Logged in but hasn't claimed a username: redirect to choose-username
        if (currentPath !== '/choose-username') {
          this.router.navigate(['/choose-username']);
        }
      } else {
        // Fully authenticated: redirect from auth screens to chats dashboard
        if (currentPath === '/login' || currentPath === '/choose-username' || currentPath === '/') {
          this.router.navigate(['/chats']);
        }
      }
    });
  }
}
