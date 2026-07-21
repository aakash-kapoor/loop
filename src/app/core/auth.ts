import { Injectable, signal } from '@angular/core';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { auth, db } from './firebase.config';
import { AppUser } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class Auth {
  readonly currentUser = signal<AppUser | null | undefined>(undefined);
  private activePresenceUid: string | null = null;

  constructor() {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        this.currentUser.set(null);
        this.activePresenceUid = null;
        return;
      }

      this.setupPresenceListeners(firebaseUser.uid);

      try {
        // Fetch user profile from firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const appUser = userSnap.data() as AppUser;
          // Update online status
          await updateDoc(userRef, {
            isOnline: true,
            lastSeen: Date.now(),
          }).catch(() => { });

          this.currentUser.set({
            ...appUser,
            isOnline: true,
            lastSeen: Date.now(),
          });
        } else {
          // User profile doesn't exist yet, they need to choose a username
          const tempUser: AppUser = {
            uid: firebaseUser.uid,
            username: '',
            usernameLower: '',
            displayName: firebaseUser.displayName || 'User',
            photoURL: firebaseUser.photoURL || undefined,
            isOnline: true,
            lastSeen: Date.now(),
          };
          this.currentUser.set(tempUser);
        }
      } catch (error) {
        console.warn('Firestore user fetch failed. Falling back to temporary local session:', error);

        // Fallback: Create a temporary user session to allow local preview of the application
        const tempUser: AppUser = {
          uid: firebaseUser.uid,
          username: '', // Triggers redirection to choose-username
          usernameLower: '',
          displayName: firebaseUser.displayName || 'Local User',
          photoURL: firebaseUser.photoURL || undefined,
          isOnline: true,
          lastSeen: Date.now(),
        };
        this.currentUser.set(tempUser);
      }
    });
  }

  private setupPresenceListeners(uid: string) {
    if (this.activePresenceUid === uid) return;
    this.activePresenceUid = uid;

    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    const GRACE_PERIOD_MS = 10000; // 30 seconds grace period for tab switches

    const updatePresence = (isOnline: boolean) => {
      const user = this.currentUser();
      if (!user?.uid || user.uid !== uid) return;

      const now = Date.now();
      const userRef = doc(db, 'users', uid);
      updateDoc(userRef, {
        isOnline,
        lastSeen: now,
      }).catch(() => { });

      this.currentUser.set({
        ...user,
        isOnline,
        lastSeen: now,
      });
    };

    // Update status when switching browser tabs or hiding the app window
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // Start grace period timer before setting status to offline
        if (offlineTimer) clearTimeout(offlineTimer);
        offlineTimer = setTimeout(() => {
          updatePresence(false);
        }, GRACE_PERIOD_MS);
      } else if (document.visibilityState === 'visible') {
        // If user came back before grace period expired, cancel timer
        if (offlineTimer) {
          clearTimeout(offlineTimer);
          offlineTimer = null;
        }
        updatePresence(true);
      }
    });

    // Mark offline immediately when closing the browser window/tab (no grace delay)
    window.addEventListener('beforeunload', () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      updatePresence(false);
    });

    window.addEventListener('pagehide', () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      updatePresence(false);
    });
  }

  async loginWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }

  async logout(): Promise<void> {
    const user = this.currentUser();
    if (user?.uid && user.username) {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        isOnline: false,
        lastSeen: Date.now(),
      }).catch(() => { });
    }
    await signOut(auth);
  }

  async checkUsernameAvailable(username: string): Promise<boolean> {
    const usernameLower = username.trim().toLowerCase();
    if (!usernameLower) return false;

    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('usernameLower', '==', usernameLower), limit(1));
    const querySnapshot = await getDocs(q);
    return querySnapshot.empty;
  }

  async claimUsername(
    username: string,
    publicKey?: string,
    encryptedPrivateKey?: string,
    salt?: string
  ): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      throw new Error('No user is currently signed in');
    }

    const available = await this.checkUsernameAvailable(username);
    if (!available) {
      throw new Error('Username is already taken');
    }

    const cleanedUsername = username.trim();
    const updatedUser: AppUser = {
      ...user,
      username: cleanedUsername,
      usernameLower: cleanedUsername.toLowerCase(),
      isOnline: true,
      lastSeen: Date.now(),
    };

    if (publicKey) {
      updatedUser.publicKey = publicKey;
    }

    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, updatedUser);

    if (encryptedPrivateKey && salt) {
      const backupRef = doc(db, 'users', user.uid, 'private', 'keyBackup');
      await setDoc(backupRef, {
        encryptedPrivateKey,
        salt,
        iterations: 210000
      });
    }

    this.currentUser.set(updatedUser);
  }

  async updatePrivacySettings(settings: { showLastSeen?: boolean }): Promise<void> {
    const user = this.currentUser();
    if (!user?.uid) return;

    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      ...settings,
    });

    this.currentUser.set({
      ...user,
      ...settings,
    });
  }
}

