import { Component, inject, computed, effect } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';
import { CryptoService } from './services/crypto.service';
import { PwaService } from './services/pwa.service';
import { LiveKitService } from './services/livekit.service';
import { ToastComponent } from './shared/toast/toast';
import { IncomingCallModalComponent } from './features/chat/call-modal/incoming-call-modal';
import { CallModalComponent } from './features/chat/call-modal/call-modal';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent, IncomingCallModalComponent, CallModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly authService = inject(Auth);
  private readonly router = inject(Router);
  private readonly cryptoService = inject(CryptoService);
  private readonly pwaService = inject(PwaService);
  private readonly liveKitService = inject(LiveKitService);

  // App is loading while the initial authentication state is unresolved (undefined)
  readonly isLoading = computed(() => this.authService.currentUser() === undefined);

  constructor() {
    // Listen for incoming call signals for authenticated user
    effect(() => {
      const user = this.authService.currentUser();
      if (user?.uid) {
        this.liveKitService.listenForIncomingCalls(user.uid);
      } else if (user === null) {
        this.liveKitService.stopListeningForIncomingCalls();
      }
    });

    // Global Routing Coordinator: reactively moves user based on auth profile changes
    effect(() => {
      const user = this.authService.currentUser();
      if (user === undefined) return; // Wait for initial session fetch

      // Read the actual browser pathname safely to prevent premature redirect to /chats on page refresh
      const currentPath = (typeof window !== 'undefined' && window.location.pathname) 
        ? window.location.pathname 
        : (this.router.url || '/');

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
        // Fully authenticated: redirect to chats dashboard ONLY if their local private key is ready.
        // Wait until key loading from IndexedDB is complete to prevent cold-load flash-redirects.
        if (this.cryptoService.isKeyLoading()) return;

        if (!this.cryptoService.isPrivateKeyReady()) {
          if (currentPath !== '/login') {
            this.router.navigate(['/login']);
          }
        } else {
          if (currentPath === '/login' || currentPath === '/choose-username' || currentPath === '/') {
            this.router.navigate(['/chats']);
          }
        }
      }
    });
  }
}
