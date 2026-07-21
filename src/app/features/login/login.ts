import { Component, inject, ElementRef, viewChild, AfterViewInit, signal, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { CryptoService } from '../../services/crypto.service';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../core/firebase.config';
import { animate } from 'motion';
import { FormsModule } from '@angular/forms';
import { evaluatePassphraseStrength } from '../../shared/passphrase-validator';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements AfterViewInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly cryptoService = inject(CryptoService);
  
  readonly isLoggingIn = signal<boolean>(false);

  // E2EE Restore States
  readonly recoveryPassphrase = signal<string>(``);
  readonly recoveryConfirmPassphrase = signal<string>(``);
  readonly recoveryError = signal<string>(``);
  readonly isRestoring = signal<boolean>(false);
  readonly isConfirmingReset = signal<boolean>(false);
  readonly hasBackup = signal<boolean | null>(null); // null = unchecked, true = exists, false = legacy user (no backup)

  readonly showPassphrase = signal<boolean>(false);
  readonly showConfirmPassphrase = signal<boolean>(false);

  readonly currentUser = this.auth.currentUser;
  readonly isPrivateKeyReady = this.cryptoService.isPrivateKeyReady;

  private readonly loginCard = viewChild<ElementRef<HTMLElement>>('loginCard');
  private readonly logo = viewChild<ElementRef<HTMLElement>>('logo');
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  private readonly desc = viewChild<ElementRef<HTMLElement>>('desc');
  private readonly actionBtn = viewChild<ElementRef<HTMLElement>>('actionBtn');

  constructor() {
    // Monitor user authentication to verify backup presence
    effect(() => {
      const user = this.currentUser();
      const keyReady = this.isPrivateKeyReady();
      if (user?.uid && user.username && !keyReady) {
        this.checkBackupExists();
      } else {
        this.hasBackup.set(null);
      }
    });
  }

  ngAfterViewInit() {
    // Staggered entrance animations using Motion
    const cardEl = this.loginCard()?.nativeElement;
    const logoEl = this.logo()?.nativeElement;
    const titleEl = this.title()?.nativeElement;
    const descEl = this.desc()?.nativeElement;
    const btnEl = this.actionBtn()?.nativeElement;

    if (cardEl) {
      animate(cardEl, { opacity: [0, 1], y: [40, 0] }, { duration: 0.8, ease: 'easeOut' });
    }
    if (logoEl) {
      animate(logoEl, { scale: [0.5, 1], opacity: [0, 1] }, { duration: 0.6, delay: 0.2, ease: 'backOut' });
    }
    if (titleEl) {
      animate(titleEl, { opacity: [0, 1], y: [10, 0] }, { duration: 0.5, delay: 0.4 });
    }
    if (descEl) {
      animate(descEl, { opacity: [0, 1], y: [10, 0] }, { duration: 0.5, delay: 0.5 });
    }
    if (btnEl) {
      animate(btnEl, { opacity: [0, 1], y: [10, 0] }, { duration: 0.5, delay: 0.6 });
    }
  }

  async signIn() {
    if (this.isLoggingIn()) return;
    this.isLoggingIn.set(true);
    try {
      await this.auth.loginWithGoogle();
    } catch (error) {
      console.error('Sign-in failed:', error);
      this.isLoggingIn.set(false);
    }
  }

  async checkBackupExists() {
    const user = this.currentUser();
    if (!user) return;
    try {
      const backupRef = doc(db, 'users', user.uid, 'private', 'keyBackup');
      const backupSnap = await getDoc(backupRef);
      this.hasBackup.set(backupSnap.exists());
    } catch (e) {
      console.error('Error checking user key backup:', e);
      this.hasBackup.set(false);
    }
  }

  async restoreKey() {
    const pass = this.recoveryPassphrase();
    if (!pass) return;

    this.isRestoring.set(true);
    this.recoveryError.set('');
    try {
      const user = this.currentUser()!;
      const backupRef = doc(db, 'users', user.uid, 'private', 'keyBackup');
      const backupSnap = await getDoc(backupRef);
      
      if (!backupSnap.exists()) {
        throw new Error('No key backup found for this account.');
      }

      const data = backupSnap.data();
      await this.cryptoService.restorePrivateKey(
        user.uid,
        data['encryptedPrivateKey'],
        data['salt'],
        pass
      );
    } catch (err: any) {
      console.error('Key restoration failed:', err);
      this.recoveryError.set('Incorrect passphrase or invalid backup. Please try again.');
    } finally {
      this.isRestoring.set(false);
    }
  }

  async setupLegacyEncryption() {
    const pass = this.recoveryPassphrase();
    const confirm = this.recoveryConfirmPassphrase();

    const strength = evaluatePassphraseStrength(pass);
    if (!strength.isValid) {
      this.recoveryError.set(strength.message || 'Passphrase is not strong enough.');
      return;
    }
    if (pass !== confirm) {
      this.recoveryError.set('Passphrases do not match.');
      return;
    }

    this.isRestoring.set(true);
    this.recoveryError.set('');
    try {
      const user = this.currentUser()!;
      
      // Generate RSA key pair locally
      const keyPair = await this.cryptoService.generateUserKeyPair();

      // Encrypt and backup private key using passphrase
      const backup = await this.cryptoService.backupPrivateKey(user.uid, keyPair.privateKey, pass);

      // Export public key to JWK
      const publicJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
      const publicKeyString = JSON.stringify(publicJwk);

      // Write public key to users public profile
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { publicKey: publicKeyString });

      // Save private key backup securely in the nested owner-only subcollection
      const backupRef = doc(db, 'users', user.uid, 'private', 'keyBackup');
      await setDoc(backupRef, {
        encryptedPrivateKey: backup.encryptedKey,
        salt: backup.salt,
        iterations: 210000
      });

      // Save private key locally in IndexedDB
      await this.cryptoService.savePrivateKeyToLocal(user.uid, keyPair.privateKey);
    } catch (err: any) {
      console.error('Setup E2EE failed:', err);
      this.recoveryError.set('Failed to set up encryption. Please try again.');
    } finally {
      this.isRestoring.set(false);
    }
  }

  async resetChatHistory() {
    const pass = this.recoveryPassphrase();
    const confirm = this.recoveryConfirmPassphrase();

    const strength = evaluatePassphraseStrength(pass);
    if (!strength.isValid) {
      this.recoveryError.set(strength.message || 'Passphrase is not strong enough.');
      return;
    }
    if (pass !== confirm) {
      this.recoveryError.set('Passphrases do not match.');
      return;
    }

    this.isRestoring.set(true);
    this.recoveryError.set('');
    try {
      const user = this.currentUser()!;
      
      // 1. Generate a fresh key pair
      const keyPair = await this.cryptoService.generateUserKeyPair();

      // 2. Encrypt and backup the new private key
      const backup = await this.cryptoService.backupPrivateKey(user.uid, keyPair.privateKey, pass);

      // 3. Overwrite publicKey on /users/{uid}
      const publicJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
      const publicKeyString = JSON.stringify(publicJwk);

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { publicKey: publicKeyString });

      // 4. Overwrite backup doc in private subcollection
      const backupRef = doc(db, 'users', user.uid, 'private', 'keyBackup');
      await setDoc(backupRef, {
        encryptedPrivateKey: backup.encryptedKey,
        salt: backup.salt,
        iterations: 210000
      });

      // 5. Store private key locally
      await this.cryptoService.savePrivateKeyToLocal(user.uid, keyPair.privateKey);

      // Reset confirmation states
      this.isConfirmingReset.set(false);
      this.recoveryPassphrase.set('');
      this.recoveryConfirmPassphrase.set('');
    } catch (err: any) {
      console.error('Key reset failed:', err);
      this.recoveryError.set('Failed to reset keys. Please try again.');
    } finally {
      this.isRestoring.set(false);
    }
  }
}
