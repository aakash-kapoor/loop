import { Injectable, inject, signal } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { Auth } from '../core/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../core/firebase.config';

const DB_NAME = 'loop_crypto_db';
const STORE_NAME = 'private_keys';
const PBKDF2_ITERATIONS = 210000;

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
  });
}

async function saveKeyToLocal(uid: string, key: CryptoKey): Promise<void> {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(key, uid);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getKeyFromLocal(uid: string): Promise<CryptoKey | null> {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(uid);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteKeyFromLocal(uid: string): Promise<void> {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(uid);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deriveBackupKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(passphrase);
  
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

@Injectable({
  providedIn: 'root',
})
export class CryptoService {
  private readonly auth = inject(Auth);

  readonly isPrivateKeyReady = signal<boolean>(false);
  readonly isKeyLoading = signal<boolean>(true);
  private localPrivateKey: CryptoKey | null = null;

  // Encapsulated cache of decrypted AES group keys: convoId -> CryptoKey
  private readonly groupKeysCache = new Map<string, CryptoKey>();

  setGroupKey(convoId: string, key: CryptoKey): void {
    this.groupKeysCache.set(convoId, key);
  }

  getGroupKey(convoId: string): CryptoKey | undefined {
    return this.groupKeysCache.get(convoId);
  }

  hasGroupKey(convoId: string): boolean {
    return this.groupKeysCache.has(convoId);
  }

  constructor() {
    // Monitor auth changes safely using toObservable + switchMap to avoid async effect track loss
    toObservable(this.auth.currentUser).pipe(
      switchMap(async (user) => {
        if (user?.uid && user.username) {
          try {
            const key = await getKeyFromLocal(user.uid);
            return { user, key, loaded: true };
          } catch (e) {
            console.warn('Failed to load private key from IndexedDB:', e);
            return { user, key: null, loaded: true };
          }
        }
        return { user, key: null, loaded: user === null };
      }),
      takeUntilDestroyed()
    ).subscribe(({ user, key, loaded }) => {
      if (user?.uid && user.username) {
        if (key) {
          this.localPrivateKey = key;
          this.isPrivateKeyReady.set(true);
        } else {
          this.localPrivateKey = null;
          this.isPrivateKeyReady.set(false);
        }
      } else if (user === null) {
        this.clearCache();
      }
      this.isKeyLoading.set(!loaded);
    });
  }

  // Get or decrypt the symmetric key for a conversation
  async getOrDecryptConversationKey(convoId: string): Promise<CryptoKey | null> {
    let aesKey = this.getGroupKey(convoId);
    if (aesKey) return aesKey;

    const user = this.auth.currentUser();
    if (!user) return null;

    const myPrivateKey = this.getLoadedPrivateKey();
    if (!myPrivateKey) return null;

    try {
      const envelopeRef = doc(db, 'conversations', convoId, 'keys', user.uid);
      const envelopeSnap = await getDoc(envelopeRef);
      if (envelopeSnap.exists()) {
        const encryptedKeyBase64 = envelopeSnap.data()['encryptedKey'];
        aesKey = await this.decryptGroupKey(encryptedKeyBase64, myPrivateKey);
        this.setGroupKey(convoId, aesKey);
        return aesKey;
      }
    } catch (e) {
      console.warn('Failed to fetch/decrypt group key for conversation:', convoId, e);
    }
    return null;
  }

  // Generate User RSA-OAEP Key Pair (Modulus 2048-bit, SHA-256)
  async generateUserKeyPair(): Promise<CryptoKeyPair> {
    return window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]), // 65537
        hash: 'SHA-256',
      },
      true, // must be extractable for backup exporting
      ['encrypt', 'decrypt']
    );
  }

  // Store Private Key in Local IndexedDB
  async savePrivateKeyToLocal(uid: string, key: CryptoKey): Promise<void> {
    await saveKeyToLocal(uid, key);
    this.localPrivateKey = key;
    this.isPrivateKeyReady.set(true);
  }

  // Get Private Key Reference
  getLoadedPrivateKey(): CryptoKey | null {
    return this.localPrivateKey;
  }

  // Backup Private Key using PBKDF2 Derived AES Key & Random Salt
  async backupPrivateKey(uid: string, privateKey: CryptoKey, passphrase: string): Promise<{ encryptedKey: string; salt: string }> {
    const jwk = await window.crypto.subtle.exportKey('jwk', privateKey);
    const jwkString = JSON.stringify(jwk);

    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const saltBase64 = btoa(String.fromCharCode(...salt));

    const backupKey = await deriveBackupKey(passphrase, salt);
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      backupKey,
      enc.encode(jwkString)
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    const encryptedKey = btoa(String.fromCharCode(...combined));
    return { encryptedKey, salt: saltBase64 };
  }

  // Restore Private Key from Encrypted Backup Blob
  async restorePrivateKey(uid: string, encryptedBackup: string, saltBase64: string, passphrase: string): Promise<CryptoKey> {
    const saltBinary = atob(saltBase64);
    const salt = new Uint8Array(saltBinary.length);
    for (let i = 0; i < saltBinary.length; i++) {
      salt[i] = saltBinary.charCodeAt(i);
    }

    const backupKey = await deriveBackupKey(passphrase, salt);

    const binary = atob(encryptedBackup);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      backupKey,
      ciphertext
    );

    const jwkString = new TextDecoder().decode(decrypted);
    const jwk = JSON.parse(jwkString);

    const privateKey = await window.crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt']
    );

    await this.savePrivateKeyToLocal(uid, privateKey);
    return privateKey;
  }

  /**
   * TODO: Key Rotation Architecture
   * Envelopes in /conversations/{convoId}/keys/{uid} are immutable-by-design (allow update, delete: if false).
   * To perform a key rotation in the future:
   * 1. Generate a new AES-256 group key.
   * 2. Upload a new envelope set (e.g., to /conversations/{convoId}/keys_v2/{uid}).
   * 3. Increment lastMessageEncryptionVersion on the parent conversation document.
   */
  // Generate AES Symmetric Key
  async generateGroupKey(): Promise<CryptoKey> {
    return window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Encrypt Group key (AES) using Bob's Public Key (RSA)
  async encryptGroupKey(aesKey: CryptoKey, publicJwkString: string): Promise<string> {
    const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
    const publicKey = await window.crypto.subtle.importKey(
      'jwk',
      JSON.parse(publicJwkString),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt']
    );

    const encryptedKey = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      rawAesKey
    );

    return btoa(String.fromCharCode(...new Uint8Array(encryptedKey)));
  }

  // Decrypt Group key (AES) using Alice's Private Key (RSA)
  async decryptGroupKey(encryptedKeyBase64: string, myPrivateKey: CryptoKey): Promise<CryptoKey> {
    const binary = atob(encryptedKeyBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const decryptedRaw = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      myPrivateKey,
      bytes
    );

    return window.crypto.subtle.importKey(
      'raw',
      decryptedRaw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // AES Message Text Encryption
  async encryptText(text: string, aesKey: CryptoKey): Promise<string> {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      enc.encode(text)
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  // AES Message Text Decryption
  async decryptText(base64Ciphertext: string, aesKey: CryptoKey): Promise<string> {
    const binary = atob(base64Ciphertext);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  }

  // Clear in-memory caches on logout (preserves local IndexedDB private key)
  clearCache() {
    this.groupKeysCache.clear();
    this.localPrivateKey = null;
    this.isPrivateKeyReady.set(false);
    this.isKeyLoading.set(false);
  }
}
