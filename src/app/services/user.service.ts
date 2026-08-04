import { Injectable, signal } from '@angular/core';
import { collection, doc, query, where, getDoc, getDocs, limit, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { AppUser } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  readonly usersCache = signal<Record<string, AppUser>>({});
  
  // Track active real-time profile subscriptions to avoid duplicates
  private readonly subscriptions = new Map<string, () => void>();

  clearCache(): void {
    this.subscriptions.forEach((unsub) => unsub());
    this.subscriptions.clear();
    this.usersCache.set({});
  }

  // Subscribe to a user document in real-time
  private subscribeToUserProfile(uid: string) {
    if (this.subscriptions.has(uid)) return;

    const userRef = doc(db, 'users', uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const profile = snap.data() as AppUser;
        this.usersCache.set({
          ...this.usersCache(),
          [uid]: profile,
        });
      } else {
        const deletedUserFallback: AppUser = {
          uid,
          username: 'deleted_user',
          usernameLower: 'deleted_user',
          displayName: 'Deleted User',
          photoURL: undefined,
          isOnline: false,
          lastSeen: 0,
        };
        this.usersCache.set({
          ...this.usersCache(),
          [uid]: deletedUserFallback,
        });
      }
    }, (err) => {
      console.warn(`Failed to listen to profile updates for uid ${uid}:`, err);
    });

    this.subscriptions.set(uid, unsub);
  }

  async searchUsersByUsername(queryStr: string, currentUserUid?: string): Promise<AppUser[]> {
    const cleaned = queryStr.trim().toLowerCase();
    if (!cleaned) return [];

    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('usernameLower', '>=', cleaned),
      where('usernameLower', '<=', cleaned + '\uf8ff'),
      limit(15)
    );

    const snapshot = await getDocs(q);
    const results: AppUser[] = [];
    snapshot.forEach((d) => {
      const u = d.data() as AppUser;
      if (u.uid !== currentUserUid) {
        results.push(u);
      }
    });
    return results;
  }

  fetchParticipantProfiles(uids: string[]): void {
    // Convert single fetches to real-time doc listeners
    uids.forEach((uid) => {
      this.subscribeToUserProfile(uid);
    });
  }

  async getUserProfile(uid: string): Promise<AppUser | null> {
    this.subscribeToUserProfile(uid);

    const cache = this.usersCache();
    if (cache[uid]) return cache[uid];

    // Single-pass check to return the profile immediately for async calls
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      return snap.data() as AppUser;
    }
    return {
      uid,
      username: 'deleted_user',
      usernameLower: 'deleted_user',
      displayName: 'Deleted User',
      photoURL: undefined,
      isOnline: false,
      lastSeen: 0,
    };
  }

  async getSuggestedUsers(currentUserUid?: string, limitCount = 20): Promise<AppUser[]> {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, orderBy('lastSeen', 'desc'), limit(limitCount));
    const snapshot = await getDocs(q);
    const results: AppUser[] = [];
    snapshot.forEach((d) => {
      const u = d.data() as AppUser;
      if (u.uid !== currentUserUid) {
        results.push(u);
        this.subscribeToUserProfile(u.uid);
      }
    });
    return results;
  }

  /**
   * Evaluates if a user is truly online (isOnline flag is true AND lastSeen was within the last 35 seconds)
   */
  isUserOnline(user: AppUser | null | undefined): boolean {
    if (!user || !user.isOnline) return false;
    const STALE_THRESHOLD_MS = 35000; // 35 seconds
    return Date.now() - (user.lastSeen || 0) < STALE_THRESHOLD_MS;
  }
}
