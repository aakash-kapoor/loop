import { Component, inject, signal, ElementRef, viewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { CryptoService } from '../../services/crypto.service';
import { animate } from 'motion';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-choose-username',
  imports: [FormsModule],
  templateUrl: './choose-username.html',
  styleUrl: './choose-username.scss',
})
export class ChooseUsername implements AfterViewInit, OnDestroy {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly cryptoService = inject(CryptoService);

  readonly username = signal<string>('');
  readonly isChecking = signal<boolean>(false);
  readonly isAvailable = signal<boolean | null>(null);
  readonly errorMessage = signal<string>('');
  readonly isSubmitting = signal<boolean>(false);

  readonly passphrase = signal<string>('');
  readonly confirmPassphrase = signal<string>('');
  readonly passphraseError = signal<string>('');

  readonly showPassphrase = signal<boolean>(false);
  readonly showConfirmPassphrase = signal<boolean>(false);

  private readonly usernameSubject = new Subject<string>();
  private checkSubscription?: Subscription;

  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly inputGroup = viewChild<ElementRef<HTMLElement>>('inputGroup');

  constructor() {
    this.checkSubscription = this.usernameSubject.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      switchMap(async (val) => {
        const cleanedVal = val.trim();
        
        // Validation checks
        if (cleanedVal.length < 3) {
          return { available: null, errorMessage: 'Username must be at least 3 characters' };
        }
        
        if (!/^[a-zA-Z0-9_]+$/.test(cleanedVal)) {
          return { available: null, errorMessage: 'Only letters, numbers, and underscores allowed' };
        }

        try {
          const available = await this.auth.checkUsernameAvailable(cleanedVal);
          return { 
            available, 
            errorMessage: available ? '' : 'This username is already taken' 
          };
        } catch (err) {
          console.error('Availability check failed:', err);
          return { 
            available: null, 
            errorMessage: 'Could not verify availability. Try again.' 
          };
        }
      })
    ).subscribe((res) => {
      this.isAvailable.set(res.available);
      this.errorMessage.set(res.errorMessage);
      this.isChecking.set(false);
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

    const pass = this.passphrase();
    const confirmPass = this.confirmPassphrase();

    if (pass.length < 12) {
      this.passphraseError.set('Passphrase must be at least 12 characters.');
      return;
    }

    if (pass !== confirmPass) {
      this.passphraseError.set('Passphrases do not match.');
      return;
    }

    this.passphraseError.set('');
    this.isSubmitting.set(true);
    try {
      const user = this.auth.currentUser();
      if (!user) throw new Error('Not authenticated');

      // Generate RSA key pair locally
      const keyPair = await this.cryptoService.generateUserKeyPair();

      // Encrypt and backup the private key using the passphrase
      const backup = await this.cryptoService.backupPrivateKey(user.uid, keyPair.privateKey, pass);

      // Export public key to JWK
      const publicJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
      const publicKeyString = JSON.stringify(publicJwk);

      // Claim username and write public key & backup to Firestore
      await this.auth.claimUsername(
        finalUsername,
        publicKeyString,
        backup.encryptedKey,
        backup.salt
      );

      // Store private key locally in IndexedDB
      await this.cryptoService.savePrivateKeyToLocal(user.uid, keyPair.privateKey);

      this.router.navigate(['/']);
    } catch (err: any) {
      console.error('Claim/Key generation failed:', err);
      this.errorMessage.set(err.message || 'Failed to claim username. Please try again.');
      this.isAvailable.set(null);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
