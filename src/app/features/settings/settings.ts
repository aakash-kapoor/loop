import { Component, inject, computed, signal, OnInit, ElementRef, viewChild, HostListener } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { fileToCompressedDataUrl, formatBytes, MAX_FILE_SIZE_BYTES } from '../../shared/utils/image-compressor';

@Component({
  selector: 'app-settings',
  imports: [NgClass, RouterLink, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  host: {
    class: 'block h-full w-full min-h-0 overflow-hidden',
  },
})
export class Settings implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly currentUser = computed(() => this.auth.currentUser());

  readonly darkModeEnabled = signal<boolean>(false);
  readonly notificationsEnabled = signal<boolean>(true);
  readonly soundEnabled = signal<boolean>(true);
  readonly showLastSeenEnabled = signal<boolean>(true);

  // Profile Edit State Signals
  readonly isEditingProfile = signal<boolean>(false);
  readonly isAvatarMenuOpen = signal<boolean>(false);
  readonly editedDisplayName = signal<string>('');
  readonly isSavingProfile = signal<boolean>(false);
  readonly isUploadingPhoto = signal<boolean>(false);
  readonly profileError = signal<string | null>(null);
  readonly profileSuccess = signal<string | null>(null);
  readonly newAvatarDataUrl = signal<string | null>(null);

  private readonly photoInput = viewChild<ElementRef<HTMLInputElement>>('photoInput');

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.isAvatarMenuOpen()) return;
    const target = event.target as HTMLElement;
    const isAvatarContainer = target.closest('.avatar-container');
    const isAvatarMenu = target.closest('.avatar-menu-dropdown');
    if (!isAvatarContainer && !isAvatarMenu) {
      this.isAvatarMenuOpen.set(false);
    }
  }

  toggleAvatarMenu(event: Event) {
    event.stopPropagation();
    this.isAvatarMenuOpen.set(!this.isAvatarMenuOpen());
  }

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

  startEditingProfile() {
    const user = this.currentUser();
    this.editedDisplayName.set(user?.displayName || '');
    this.newAvatarDataUrl.set(null);
    this.profileError.set(null);
    this.profileSuccess.set(null);
    this.isEditingProfile.set(true);
  }

  cancelEditingProfile() {
    this.isEditingProfile.set(false);
    this.newAvatarDataUrl.set(null);
    this.profileError.set(null);
  }

  triggerPhotoInput() {
    this.isAvatarMenuOpen.set(false);
    this.photoInput()?.nativeElement.click();
  }

  async onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    input.value = '';

    if (!file.type.startsWith('image/')) {
      this.profileError.set('Please select a valid image file.');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      this.profileError.set(`Image exceeds the 500 KB limit (${formatBytes(file.size)}).`);
      return;
    }

    this.isUploadingPhoto.set(true);
    this.profileError.set(null);

    try {
      // Compress avatar to 400x400 max dimension Data URL
      const { dataUrl } = await fileToCompressedDataUrl(file, undefined, 400, 400, 0.85);
      this.newAvatarDataUrl.set(dataUrl);

      // Auto-save photo immediately or let user confirm
      if (!this.isEditingProfile()) {
        await this.auth.updateUserProfile({ photoURL: dataUrl });
        this.showSuccess('Profile photo updated successfully!');
      }
    } catch (err: any) {
      console.error('Failed to process photo:', err);
      this.profileError.set(err.message || 'Failed to process image.');
    } finally {
      this.isUploadingPhoto.set(false);
    }
  }

  async removePhoto() {
    this.isAvatarMenuOpen.set(false);
    this.isUploadingPhoto.set(true);
    this.profileError.set(null);
    try {
      await this.auth.updateUserProfile({ photoURL: null });
      this.newAvatarDataUrl.set(null);
      this.showSuccess('Profile photo removed!');
    } catch (err: any) {
      console.error('Failed to remove photo:', err);
      this.profileError.set(err.message || 'Failed to remove photo.');
    } finally {
      this.isUploadingPhoto.set(false);
    }
  }

  async saveProfile() {
    const name = this.editedDisplayName().trim();
    if (!name) {
      this.profileError.set('Display name cannot be empty.');
      return;
    }

    this.isSavingProfile.set(true);
    this.profileError.set(null);

    try {
      const updates: { displayName: string; photoURL?: string } = {
        displayName: name,
      };

      if (this.newAvatarDataUrl()) {
        updates.photoURL = this.newAvatarDataUrl()!;
      }

      await this.auth.updateUserProfile(updates);
      this.isEditingProfile.set(false);
      this.newAvatarDataUrl.set(null);
      this.showSuccess('Profile updated successfully!');
    } catch (err: any) {
      console.error('Save profile failed:', err);
      this.profileError.set(err.message || 'Failed to update profile.');
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  private showSuccess(msg: string) {
    this.profileSuccess.set(msg);
    setTimeout(() => this.profileSuccess.set(null), 3000);
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
