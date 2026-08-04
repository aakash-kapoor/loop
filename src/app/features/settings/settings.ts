import { Component, inject, computed, signal, OnInit, ElementRef, viewChild, HostListener } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { ToastService } from '../../services/toast.service';
import { ConfirmModal } from '../../shared/confirm-modal/confirm-modal';
import { fileToCompressedDataUrl, formatBytes, MAX_FILE_SIZE_BYTES } from '../../shared/utils/image-compressor';

@Component({
  selector: 'app-settings',
  imports: [NgClass, RouterLink, FormsModule, ConfirmModal],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  host: {
    class: 'block h-full w-full min-h-0 overflow-hidden',
  },
})
export class Settings implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);

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
  readonly newAvatarDataUrl = signal<string | null>(null);

  // Delete Account Confirmation State Signals
  readonly showDeleteModal = signal<boolean>(false);
  readonly isDeletingAccount = signal<boolean>(false);
  readonly deleteModalError = signal<string | null>(null);

  openDeleteModal() {
    this.deleteModalError.set(null);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal() {
    if (this.isDeletingAccount()) return;
    this.deleteModalError.set(null);
    this.showDeleteModal.set(false);
  }

  async confirmDeleteAccount() {
    this.isDeletingAccount.set(true);
    this.deleteModalError.set(null);
    try {
      await this.auth.deleteAccount();
      this.showDeleteModal.set(false);
      this.toastService.show('Your account has been successfully deleted.', 'success');
      this.router.navigate(['/login']);
    } catch (err: any) {
      console.error('Delete account failed:', err);
      this.deleteModalError.set(err.message || 'Failed to delete account.');
      // Keep delete modal open so error is displayed directly in the modal
    } finally {
      this.isDeletingAccount.set(false);
    }
  }

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
    this.isEditingProfile.set(true);
  }

  cancelEditingProfile() {
    this.isEditingProfile.set(false);
    this.newAvatarDataUrl.set(null);
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
      this.toastService.show('Please select a valid image file.', 'error');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      this.toastService.show(`Image exceeds the 500 KB limit (${formatBytes(file.size)}).`, 'error');
      return;
    }

    this.isUploadingPhoto.set(true);

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
      this.toastService.show(err.message || 'Failed to process image.', 'error');
    } finally {
      this.isUploadingPhoto.set(false);
    }
  }

  async removePhoto() {
    this.isAvatarMenuOpen.set(false);
    this.isUploadingPhoto.set(true);
    try {
      await this.auth.updateUserProfile({ photoURL: null });
      this.newAvatarDataUrl.set(null);
      this.showSuccess('Profile photo removed!');
    } catch (err: any) {
      console.error('Failed to remove photo:', err);
      this.toastService.show(err.message || 'Failed to remove photo.', 'error');
    } finally {
      this.isUploadingPhoto.set(false);
    }
  }

  async saveProfile() {
    const name = this.editedDisplayName().trim();
    if (!name) {
      this.toastService.show('Display name cannot be empty.', 'error');
      return;
    }

    this.isSavingProfile.set(true);

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
      this.toastService.show(err.message || 'Failed to update profile.', 'error');
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  private showSuccess(msg: string) {
    this.toastService.show(msg, 'success');
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
      this.toastService.show('You have been logged out.', 'info');
      this.router.navigate(['/login']);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }

  goBack() {
    this.router.navigate(['/chats']);
  }
}
