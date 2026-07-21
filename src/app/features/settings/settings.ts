import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgClass } from '@angular/common';
import { Auth } from '../../core/auth';

@Component({
  selector: 'app-settings',
  imports: [NgClass, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly currentUser = computed(() => this.auth.currentUser());
  
  readonly darkModeEnabled = signal<boolean>(false);
  readonly notificationsEnabled = signal<boolean>(true);
  readonly soundEnabled = signal<boolean>(true);
  readonly showLastSeenEnabled = signal<boolean>(true);

  ngOnInit() {
    // Check initial dark mode state from document root
    const hasDark = document.documentElement.classList.contains('dark');
    this.darkModeEnabled.set(hasDark);

    // Read stored preferences
    this.soundEnabled.set(localStorage.getItem('sound_effects') !== 'false');
    this.notificationsEnabled.set(localStorage.getItem('notifications') !== 'false');
    
    // Read user privacy preference
    const user = this.currentUser();
    this.showLastSeenEnabled.set(user?.showLastSeen ?? true);
  }

  toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    this.darkModeEnabled.set(isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  toggleNotifications() {
    const nextVal = !this.notificationsEnabled();
    this.notificationsEnabled.set(nextVal);
    localStorage.setItem('notifications', nextVal ? 'true' : 'false');

    // Request permissions dynamically when enabled
    if (nextVal && Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission !== 'granted') {
          this.notificationsEnabled.set(false);
          localStorage.setItem('notifications', 'false');
        }
      });
    }
  }

  toggleSound() {
    const nextVal = !this.soundEnabled();
    this.soundEnabled.set(nextVal);
    localStorage.setItem('sound_effects', nextVal ? 'true' : 'false');
  }

  async toggleShowLastSeen() {
    const nextVal = !this.showLastSeenEnabled();
    this.showLastSeenEnabled.set(nextVal);
    try {
      await this.auth.updatePrivacySettings({ showLastSeen: nextVal });
    } catch (err) {
      console.error('Failed to update last seen preference:', err);
      this.showLastSeenEnabled.set(!nextVal);
    }
  }

  async logout() {
    try {
      await this.auth.logout();
      this.router.navigate(['/login']);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }

  goBack() {
    this.router.navigate(['/chats']);
  }
}
