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

  constructor() {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        this.currentUser.set(null);
        return;
      }

      // Fetch user profile from firestore
      const userRef = doc(db, 'users', firebaseUser.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const appUser = userSnap.data() as AppUser;
        // Update online status
        await updateDoc(userRef, {
          isOnline: true,
          lastSeen: Date.now(),
        });
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
      }).catch(() => {});
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

  async claimUsername(username: string): Promise<void> {
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

    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, updatedUser);
    this.currentUser.set(updatedUser);
  }
}

