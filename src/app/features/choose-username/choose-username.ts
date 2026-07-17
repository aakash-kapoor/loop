import { Component, inject, signal, ElementRef, viewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { animate } from 'motion';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'app-choose-username',
  imports: [FormsModule],
  templateUrl: './choose-username.html',
  styleUrl: './choose-username.scss',
})
export class ChooseUsername implements AfterViewInit, OnDestroy {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly username = signal<string>('');
  readonly isChecking = signal<boolean>(false);
  readonly isAvailable = signal<boolean | null>(null);
  readonly errorMessage = signal<string>('');
  readonly isSubmitting = signal<boolean>(false);

  private readonly usernameSubject = new Subject<string>();
  private checkSubscription?: Subscription;

  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly inputGroup = viewChild<ElementRef<HTMLElement>>('inputGroup');

  constructor() {
    this.checkSubscription = this.usernameSubject.pipe(
      debounceTime(500),
      distinctUntilChanged()
    ).subscribe(async (val) => {
      const cleanedVal = val.trim();
      
      // Validation checks
      if (cleanedVal.length < 3) {
        this.isAvailable.set(null);
        this.errorMessage.set('Username must be at least 3 characters');
        this.isChecking.set(false);
        return;
      }
      
      if (!/^[a-zA-Z0-9_]+$/.test(cleanedVal)) {
        this.isAvailable.set(null);
        this.errorMessage.set('Only letters, numbers, and underscores allowed');
        this.isChecking.set(false);
        return;
      }

      this.isChecking.set(true);
      this.errorMessage.set('');
      
      try {
        const available = await this.auth.checkUsernameAvailable(cleanedVal);
        this.isAvailable.set(available);
        if (!available) {
          this.errorMessage.set('This username is already taken');
        }
      } catch (err) {
        console.error('Availability check failed:', err);
        this.errorMessage.set('Could not verify availability. Try again.');
        this.isAvailable.set(null);
      } finally {
        this.isChecking.set(false);
      }
    });
  }

  ngAfterViewInit() {
    const cardEl = this.card()?.nativeElement;
    if (cardEl) {
      animate(cardEl, { opacity: [0, 1], y: [40, 0] }, { duration: 0.7, ease: 'easeOut' });
    }
  }

  ngOnDestroy() {
    this.checkSubscription?.unsubscribe();
  }

  onUsernameChange(val: string) {
    this.username.set(val);
    const cleaned = val.trim();
    if (!cleaned) {
      this.isAvailable.set(null);
      this.isChecking.set(false);
      this.errorMessage.set('');
      return;
    }
    this.isChecking.set(true);
    this.usernameSubject.next(cleaned);
  }

  async submitUsername() {
    const finalUsername = this.username().trim();
    if (!finalUsername || !this.isAvailable() || this.isChecking() || this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.auth.claimUsername(finalUsername);
      this.router.navigate(['/']);
    } catch (err: any) {
      console.error('Claim failed:', err);
      this.errorMessage.set(err.message || 'Failed to claim username. Please try again.');
      this.isAvailable.set(null);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
