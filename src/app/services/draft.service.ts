import { Injectable, inject, signal, effect } from '@angular/core';
import { Auth } from '../core/auth';

@Injectable({
  providedIn: 'root',
})
export class DraftService {
  private readonly auth = inject(Auth);

  /** Signal holding map of convoId -> draft text for the current user */
  readonly drafts = signal<Record<string, string>>({});

  constructor() {
    // Reactively reload drafts whenever the current user changes
    effect(() => {
      const user = this.auth.currentUser();
      this.reloadDrafts(user?.uid);
    });
  }

  private getStorageKey(userId?: string): string {
    const uid = userId || this.auth.currentUser()?.uid || 'guest';
    return `loop_drafts_${uid}`;
  }

  reloadDrafts(userId?: string): void {
    try {
      const raw = localStorage.getItem(this.getStorageKey(userId));
      if (raw) {
        this.drafts.set(JSON.parse(raw));
      } else {
        this.drafts.set({});
      }
    } catch (e) {
      console.error('Failed to parse drafts from localStorage:', e);
      this.drafts.set({});
    }
  }

  getDraft(convoId: string): string {
    if (!convoId) return '';
    return this.drafts()[convoId] || '';
  }

  saveDraft(convoId: string, text: string): void {
    if (!convoId) return;
    const current = { ...this.drafts() };
    if (text && text.trim()) {
      current[convoId] = text;
    } else {
      delete current[convoId];
    }
    this.drafts.set(current);
    try {
      localStorage.setItem(this.getStorageKey(), JSON.stringify(current));
    } catch (e) {
      console.error('Failed to save draft to localStorage:', e);
    }
  }

  clearDraft(convoId: string): void {
    if (!convoId) return;
    const current = { ...this.drafts() };
    if (!(convoId in current)) return;
    delete current[convoId];
    this.drafts.set(current);
    try {
      localStorage.setItem(this.getStorageKey(), JSON.stringify(current));
    } catch (e) {
      console.error('Failed to clear draft from localStorage:', e);
    }
  }
}
