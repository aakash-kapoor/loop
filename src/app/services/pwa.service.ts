import { inject, Injectable, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { ToastService } from './toast.service';
import { filter } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PwaService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly toastService = inject(ToastService);

  readonly updateAvailable = signal<boolean>(false);

  constructor() {
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          this.updateAvailable.set(true);
          this.toastService.show(
            'A new version of Loop is available. Tap Check for Updates in Settings or reload to update.',
            'info'
          );
        });
    }
  }

  async checkForUpdates(): Promise<boolean> {
    if (!this.swUpdate.isEnabled) {
      // In dev mode (ng serve) or when SW is disabled, no PWA update is pending
      return false;
    }

    try {
      const updateFound = await this.swUpdate.checkForUpdate();
      if (updateFound || this.updateAvailable()) {
        await this.swUpdate.activateUpdate();
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to check for PWA updates:', err);
      return false;
    }
  }
}
