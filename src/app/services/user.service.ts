import { Injectable, signal } from '@angular/core';
import { collection, doc, query, where, getDoc, getDocs, limit } from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { AppUser } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  readonly usersCache = signal<Record<string, AppUser>>({});

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

  async fetchParticipantProfiles(uids: string[]): Promise<void> {
    const cache = this.usersCache();
    const missingUids = uids.filter((uid) => !cache[uid]);
    if (missingUids.length === 0) return;

    const updatedCache = { ...cache };
    await Promise.all(
      missingUids.map(async (uid) => {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          updatedCache[uid] = snap.data() as AppUser;
        }
      })
    );
    this.usersCache.set(updatedCache);
  }

  async getUserProfile(uid: string): Promise<AppUser | null> {
    const cache = this.usersCache();
    if (cache[uid]) return cache[uid];

    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const profile = snap.data() as AppUser;
      this.usersCache.set({
        ...cache,
        [uid]: profile,
      });
      return profile;
    }
    return null;
  }
}
