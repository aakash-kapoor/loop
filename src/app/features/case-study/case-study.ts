import { Component, inject, signal, OnInit, AfterViewInit, OnDestroy, ElementRef } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { animate, inView, stagger } from 'motion';

@Component({
  selector: 'app-case-study',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './case-study.html',
  styleUrl: './case-study.scss',
})
export class CaseStudyComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly router = inject(Router);
  private readonly authService = inject(Auth);
  private readonly elementRef = inject(ElementRef);

  readonly activeSection = signal<'security' | 'webrtc' | 'ux'>('security');
  readonly isDarkMode = signal<boolean>(false);
  readonly scrollProgress = signal<number>(0);

  // ─── Interactive E2EE Crypto Playground State ─────────────────────────────
  readonly simInputText = signal<string>('Meet me in the secure room at 14:00 🔒');
  readonly isSimulating = signal<boolean>(false);
  readonly simSuccess = signal<boolean>(false);
  readonly simAesKeyPreview = signal<string>('');
  readonly simIvHex = signal<string>('');
  readonly simCiphertext = signal<string>('');
  readonly simRsaEnvelope = signal<string>('');
  readonly simDecryptedOutput = signal<string>('');
  readonly simExecutionTimeMs = signal<number>(0);

  // ─── Code Snippet Tabs ───────────────────────────────────────────────────
  readonly activeCodeTab = signal<'crypto' | 'pbkdf2' | 'livekit'>('crypto');
  readonly copiedCode = signal<boolean>(false);

  private themeObserver?: MutationObserver;

  ngOnInit() {
    this.isDarkMode.set(document.documentElement.classList.contains('dark'));
    
    // React to external dark mode class changes on html tag
    this.themeObserver = new MutationObserver(() => {
      this.isDarkMode.set(document.documentElement.classList.contains('dark'));
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    this.titleService.setTitle('Loop — Zero-Knowledge E2EE & WebRTC Architecture | Case Study');

    this.metaService.updateTag({
      name: 'description',
      content: 'A deep-dive technical case study into Loop: building zero-knowledge end-to-end encrypted messaging, WebRTC multi-peer calling, and a signals-first Angular architecture.',
    });
    this.metaService.updateTag({ property: 'og:title', content: 'Loop Case Study — Security & WebRTC Architecture' });
    this.metaService.updateTag({
      property: 'og:description',
      content: 'Engineering breakdown of zero-knowledge encryption, WebRTC SFU streaming, and high-performance Angular signals.',
    });
    this.metaService.updateTag({ property: 'og:type', content: 'article' });

    // Pre-run crypto simulator with sample data
    this.runCryptoSimulation();
  }

  ngOnDestroy() {
    this.themeObserver?.disconnect();
  }

  ngAfterViewInit() {
    // 1. Hero Staggered Load
    animate(
      '.hero-anim-item',
      { opacity: [0, 1], y: [25, 0] },
      { delay: stagger(0.1), duration: 0.6, ease: 'easeOut' }
    );

    // 2. Quick Stat Cards Pop-in
    animate(
      '.stat-card-anim',
      { opacity: [0, 1], scale: [0.9, 1], y: [15, 0] },
      { delay: stagger(0.08, { startDelay: 0.35 }), duration: 0.5, ease: 'backOut' }
    );

    // 3. Scroll-triggered animations for Section Headers & Comparison Cards
    inView('.section-title-anim', (el) => {
      animate(el, { opacity: [0, 1], y: [20, 0] }, { duration: 0.5, ease: 'easeOut' });
    });

    inView('.comparison-card-anim', (el) => {
      animate(el, { opacity: [0, 1], y: [30, 0] }, { duration: 0.6, ease: 'easeOut' });
    });

    inView('.spec-card-anim', (el) => {
      animate(el, { opacity: [0, 1], y: [25, 0] }, { duration: 0.6, ease: 'easeOut' });
    });

    inView('.challenge-card-anim', (el) => {
      animate(el, { opacity: [0, 1], y: [25, 0] }, { duration: 0.55, ease: 'easeOut' });
    });

    inView('.footer-cta-anim', (el) => {
      animate(el, { opacity: [0, 1], scale: [0.96, 1], y: [20, 0] }, { duration: 0.7, ease: 'easeOut' });
    });
  }

  onScroll(event: Event) {
    const target = event.target as HTMLElement;
    if (!target) return;
    const maxScroll = target.scrollHeight - target.clientHeight;
    if (maxScroll > 0) {
      const progress = Math.min(100, Math.max(0, (target.scrollTop / maxScroll) * 100));
      this.scrollProgress.set(progress);
    }
  }

  toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    this.isDarkMode.set(isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement('meta');
      metaTheme.setAttribute('name', 'theme-color');
      document.head.appendChild(metaTheme);
    }
    metaTheme.setAttribute('content', isDark ? '#0b0f19' : '#f8fafc');
  }

  setSection(section: 'security' | 'webrtc' | 'ux') {
    this.activeSection.set(section);
    setTimeout(() => {
      const activeContent = this.elementRef.nativeElement.querySelector('.tab-content-anim');
      if (activeContent) {
        animate(activeContent, { opacity: [0, 1], y: [15, 0], scale: [0.98, 1] }, { duration: 0.35, ease: 'easeOut' });
      }
    }, 0);
  }

  scrollToSection(id: string, event?: Event) {
    event?.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  launchApp() {
    const user = this.authService.currentUser();
    if (user && user.uid && user.username) {
      this.router.navigate(['/chats']);
    } else if (user && user.uid && !user.username) {
      this.router.navigate(['/choose-username']);
    } else {
      this.router.navigate(['/login']);
    }
  }

  // ─── Real WebCrypto Live Simulator ─────────────────────────────────────────
  async runCryptoSimulation() {
    if (this.isSimulating()) return;
    this.isSimulating.set(true);
    this.simSuccess.set(false);

    const startTime = performance.now();
    try {
      const plainText = this.simInputText() || 'Zero-Knowledge Payload';

      // 1. Generate an Ephemeral AES-GCM 256 symmetric key
      const aesKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // Export raw key bytes to preview hex
      const exportedRaw = await window.crypto.subtle.exportKey('raw', aesKey);
      const rawHex = Array.from(new Uint8Array(exportedRaw))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 24);
      this.simAesKeyPreview.set(`0x${rawHex}... (256-bit AES)`);

      // 2. Generate 12-byte IV & Encrypt plaintext
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const ivHexStr = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
      this.simIvHex.set(ivHexStr);

      const encoded = new TextEncoder().encode(plainText);
      const ciphertextBuf = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encoded
      );

      // Convert ciphertext to Base64
      const ciphertextArray = new Uint8Array(ciphertextBuf);
      let binaryStr = '';
      for (let i = 0; i < ciphertextArray.length; i++) {
        binaryStr += String.fromCharCode(ciphertextArray[i]);
      }
      const b64Cipher = btoa(binaryStr);
      this.simCiphertext.set(b64Cipher);

      // 3. Simulate RSA-OAEP 2048 key encapsulation envelope
      const dummyRsaEnvelope = btoa(`RSA-OAEP-2048-ENC[KEY:${rawHex.slice(0, 12)}...TAG:${ivHexStr.slice(0, 8)}]`);
      this.simRsaEnvelope.set(dummyRsaEnvelope);

      // 4. Decrypt in memory back to plaintext to verify integrity
      const decryptedBuf = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        ciphertextBuf
      );
      const decrypted = new TextDecoder().decode(decryptedBuf);
      this.simDecryptedOutput.set(decrypted);
      this.simSuccess.set(true);

      const endTime = performance.now();
      this.simExecutionTimeMs.set(Math.round((endTime - startTime) * 100) / 100);
    } catch (err) {
      console.error('Crypto simulation failed:', err);
    } finally {
      this.isSimulating.set(false);
    }
  }

  // ─── Code Snippet Tabs & Copying ──────────────────────────────────────────
  copySnippet(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      this.copiedCode.set(true);
      setTimeout(() => this.copiedCode.set(false), 2000);
    });
  }

  get activeSnippet(): string {
    switch (this.activeCodeTab()) {
      case 'crypto':
        return `// 1. Generate RSA-OAEP 2048 Key Pair in IndexedDB
async function generateUserKeyPair(): Promise<CryptoKeyPair> {
  return window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false, // Private key is non-extractable directly
    ['encrypt', 'decrypt']
  );
}

// 2. Hybrid Encryption: Encrypt AES conversation key with Peer's RSA JWK
async function encryptGroupKey(aesKey: CryptoKey, peerPublicKeyJwk: JsonWebKey): Promise<string> {
  const peerKey = await window.crypto.subtle.importKey(
    'jwk',
    peerPublicKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
  const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
  const encryptedBuf = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    peerKey,
    rawAesKey
  );
  return bufferToBase64(encryptedBuf);
}`;

      case 'pbkdf2':
        return `// Zero-Knowledge 6-Word Diceware Passphrase Key Derivation
async function deriveBackupKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase.trim().toLowerCase()),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000, // OWASP recommended standard
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}`;

      case 'livekit':
        return `// Angular 21 Signals-driven LiveKit SFU WebRTC Bridge
@Injectable({ providedIn: 'root' })
export class LiveKitService {
  readonly roomState = signal<ConnectionState>(ConnectionState.Disconnected);
  readonly remoteParticipants = signal<RemoteParticipant[]>([]);
  readonly activeSpeakers = signal<Participant[]>([]);
  readonly isVideoEnabled = signal<boolean>(true);

  private room = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  });

  async connect(url: string, token: string) {
    this.room
      .on(RoomEvent.Connected, () => this.roomState.set(this.room.state))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => this.activeSpeakers.set(speakers))
      .on(RoomEvent.ParticipantConnected, () => this.syncParticipants());

    await this.room.connect(url, token);
  }
}`;
    }
  }
}



