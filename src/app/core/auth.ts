import { Injectable, signal } from '@angular/core';
import { GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, reauthenticateWithRedirect, signOut, onAuthStateChanged, deleteUser } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, limit, deleteField, deleteDoc, addDoc, serverTimestamp, increment } from 'firebase/firestore';
import { auth, db } from './firebase.config';
import { AppUser } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class Auth {
  readonly currentUser = signal<AppUser | null | undefined>(undefined);
  private activePresenceUid: string | null = null;
  private cachedIdToken: string | null = null;

  constructor() {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        this.currentUser.set(null);
        this.activePresenceUid = null;
        this.cachedIdToken = null;
        return;
      }

      // Proactively cache ID token synchronously for keepalive unload patches
      firebaseUser.getIdToken().then((t) => (this.cachedIdToken = t)).catch(() => {});

      this.setupPresenceListeners(firebaseUser.uid);

      try {
        // Fetch user profile from firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const appUser = userSnap.data() as AppUser;
          const photoURL = appUser.photoURL || undefined;

          const updates: Record<string, any> = {
            isOnline: true,
            lastSeen: Date.now(),
          };

          await updateDoc(userRef, updates).catch(() => { });

          this.currentUser.set({
            ...appUser,
            uid: appUser.uid || firebaseUser.uid,
            photoURL,
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

  private heartbeatTimer: any = null;

  private setupPresenceListeners(uid: string) {
    if (this.activePresenceUid === uid) return;
    this.activePresenceUid = uid;

    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    const GRACE_PERIOD_MS = 10000; // 10 seconds grace period for tab switches

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

    // Initial presence update on session load
    updatePresence(true);

    // Active heartbeat: refresh lastSeen every 15s while tab is visible
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.currentUser()?.uid === uid) {
        updatePresence(true);
      }
    }, 15000);

    const sendKeepaliveOffline = () => {
      if (!this.cachedIdToken) return;
      try {
        const projectId = db.app.options.projectId;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=isOnline&updateMask.fieldPaths=lastSeen`;
        const body = JSON.stringify({
          fields: {
            isOnline: { booleanValue: false },
            lastSeen: { integerValue: String(Date.now()) }
          }
        });
        fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.cachedIdToken}`
          },
          body,
          keepalive: true
        });
      } catch (e) {
        console.warn('Keepalive presence patch failed:', e);
      }
    };

    // Update status when switching browser tabs or hiding the app window
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // Start grace period timer before setting status to offline for tab switches
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

    // Immediate offline update on page unloads/closes via SDK + Keepalive REST patch
    window.addEventListener('pagehide', () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      updatePresence(false);
      sendKeepaliveOffline();
    });

    window.addEventListener('beforeunload', () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      updatePresence(false);
      sendKeepaliveOffline();
    });
  }

  async loginWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }

  async logout(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const user = this.currentUser();
    if (user?.uid) {
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
    const firebaseUser = auth.currentUser;
    const uid = user?.uid || firebaseUser?.uid;
    if (!uid) {
      throw new Error('No user is currently signed in');
    }

    const available = await this.checkUsernameAvailable(username);
    if (!available) {
      throw new Error('Username is already taken');
    }

    const cleanedUsername = username.trim();
    const updatedUser: AppUser = {
      ...(user || {}),
      uid,
      displayName: user?.displayName || firebaseUser?.displayName || 'User',
      photoURL: user?.photoURL || firebaseUser?.photoURL || undefined,
      username: cleanedUsername,
      usernameLower: cleanedUsername.toLowerCase(),
      isOnline: true,
      lastSeen: Date.now(),
    };

    if (publicKey) {
      updatedUser.publicKey = publicKey;
    }

    // Build payload omitting undefined values for setDoc
    const payload: Record<string, any> = {
      uid: updatedUser.uid,
      displayName: updatedUser.displayName,
      username: updatedUser.username,
      usernameLower: updatedUser.usernameLower,
      isOnline: updatedUser.isOnline,
      lastSeen: updatedUser.lastSeen,
    };
    if (updatedUser.photoURL) payload['photoURL'] = updatedUser.photoURL;
    if (updatedUser.publicKey) payload['publicKey'] = updatedUser.publicKey;
    if (updatedUser.showLastSeen !== undefined) payload['showLastSeen'] = updatedUser.showLastSeen;

    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, payload);

    if (encryptedPrivateKey && salt) {
      const backupRef = doc(db, 'users', uid, 'private', 'keyBackup');
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

  async updateUserProfile(data: { displayName?: string; photoURL?: string | null }): Promise<void> {
    const user = this.currentUser();
    if (!user?.uid) throw new Error('No user is currently signed in');

    const updates: Record<string, any> = {};
    if (data.displayName !== undefined) {
      const trimmed = data.displayName.trim();
      if (!trimmed) throw new Error('Display name cannot be empty');
      updates['displayName'] = trimmed;
    }
    if (data.photoURL === null) {
      updates['photoURL'] = deleteField();
    } else if (data.photoURL !== undefined) {
      updates['photoURL'] = data.photoURL;
    }

    if (Object.keys(updates).length === 0) return;

    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, updates);

    this.currentUser.set({
      ...user,
      ...(data.displayName !== undefined ? { displayName: data.displayName.trim() } : {}),
      photoURL: data.photoURL === null ? undefined : (data.photoURL ?? user.photoURL),
    });
  }

  async deleteAccount(): Promise<void> {
    const user = this.currentUser();
    const firebaseUser = auth.currentUser;

    if (!user?.uid || !firebaseUser) {
      throw new Error('No user is currently signed in');
    }

    // 1. Check session freshness: if sign-in was recent (< 5 mins), skip re-auth prompt
    const lastSignInTime = firebaseUser.metadata.lastSignInTime
      ? new Date(firebaseUser.metadata.lastSignInTime).getTime()
      : 0;
    const RECENT_LOGIN_THRESHOLD_MS = 5 * 60 * 1000;
    const isRecentlySignedIn = Date.now() - lastSignInTime < RECENT_LOGIN_THRESHOLD_MS;

    if (!isRecentlySignedIn) {
      try {
        const provider = new GoogleAuthProvider();
        try {
          await reauthenticateWithPopup(firebaseUser, provider);
        } catch (popupErr: any) {
          if (popupErr?.code === 'auth/popup-blocked') {
            console.warn('Re-auth popup blocked; falling back to reauthenticateWithRedirect');
            await reauthenticateWithRedirect(firebaseUser, provider);
            return;
          }
          throw popupErr;
        }
      } catch (reauthErr: any) {
        console.warn('Re-authentication before account deletion failed:', reauthErr);
        if (reauthErr?.code === 'auth/popup-closed-by-user' || reauthErr?.code === 'auth/cancelled-popup-request') {
          throw new Error('Account deletion cancelled (verification popup closed).');
        }
        if (reauthErr?.code === 'auth/requires-recent-login') {
          throw new Error('Security verification failed. Please log out, sign back in, and try again.');
        }
        throw new Error(reauthErr?.message || 'Security re-authentication failed.');
      }
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const uid = user.uid;
    const displayName = user.displayName || user.username || 'A user';
    const sysMessageText = `${displayName} deleted their account`;

    // 2. Post system message to all conversations where user is a participant
    try {
      const convosQuery = query(collection(db, 'conversations'), where('participants', 'array-contains', uid));
      const convosSnap = await getDocs(convosQuery);
      const now = Date.now();

      for (const convoDoc of convosSnap.docs) {
        try {
          const convoData = convoDoc.data();
          const participants: string[] = convoData['participants'] || [];

          await addDoc(collection(db, 'conversations', convoDoc.id, 'messages'), {
            senderId: 'system',
            text: sysMessageText,
            createdAt: serverTimestamp(),
            createdAtMs: now,
            reactions: {},
            replyTo: null,
          });

          const updates: Record<string, any> = {
            lastMessage: sysMessageText,
            lastMessageAt: now,
            lastMessageIsSystem: true,
          };

          participants.forEach((pId: string) => {
            if (pId !== uid) {
              updates[`unreadCount.${pId}`] = increment(1);
            }
          });

          await updateDoc(doc(db, 'conversations', convoDoc.id), updates);
        } catch (subErr) {
          console.warn(`Failed to send system message to conversation ${convoDoc.id}:`, subErr);
        }
      }
    } catch (convoErr) {
      console.warn('Failed to query user conversations during deletion:', convoErr);
    }

    // 3. Remove user document and private subcollection from Firestore
    try {
      const keyBackupRef = doc(db, 'users', uid, 'private', 'keyBackup');
      await deleteDoc(keyBackupRef).catch(() => {});

      const userRef = doc(db, 'users', uid);
      await deleteDoc(userRef);
    } catch (e) {
      console.warn('Failed to delete user document in Firestore:', e);
    }

    // 4. Delete user from Firebase Auth
    try {
      await deleteUser(firebaseUser);
    } catch (deleteErr: any) {
      if (deleteErr?.code === 'auth/requires-recent-login') {
        const provider = new GoogleAuthProvider();
        await reauthenticateWithPopup(firebaseUser, provider);
        await deleteUser(firebaseUser);
      } else {
        throw deleteErr;
      }
    }

    this.currentUser.set(null);
  }
}

