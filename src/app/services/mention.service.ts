import { Injectable, signal } from '@angular/core';
import { Conversation } from '../models/conversation.model';
import { AppUser } from '../models/user.model';

export interface MentionCandidate {
  uid: string;
  name: string;
  username: string;
  photoURL?: string;
  isAll?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class MentionService {
  readonly isMentionPickerOpen = signal<boolean>(false);
  readonly mentionQuery = signal<string>('');
  readonly mentionSelectedIndex = signal<number>(0);
  readonly mentionedUids = signal<string[]>([]);

  getGroupParticipantsForMention(
    convo: Conversation | null,
    currentUid: string | null | undefined,
    usersCache: Record<string, AppUser>
  ): MentionCandidate[] {
    if (!convo || convo.type !== 'group') return [];

    const query = this.mentionQuery().toLowerCase().trim();
    const candidates: MentionCandidate[] = [];

    if (!query || 'all'.includes(query) || 'everyone'.includes(query)) {
      candidates.push({
        uid: 'all',
        name: 'all (Notify everyone)',
        username: 'everyone',
        isAll: true,
      });
    }

    convo.participants.forEach((uid) => {
      if (uid === currentUid) return;
      const user = usersCache[uid];
      const name = user?.displayName || user?.username || 'User';
      const username = user?.username || '';
      if (!query || name.toLowerCase().includes(query) || username.toLowerCase().includes(query)) {
        candidates.push({
          uid,
          name,
          username,
          photoURL: user?.photoURL,
        });
      }
    });

    return candidates;
  }

  handleTextInput(val: string, cursorPos: number, isGroup: boolean) {
    if (!isGroup) {
      this.isMentionPickerOpen.set(false);
      return;
    }

    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (/\s/.test(charBeforeAt)) {
        const queryCandidate = textBeforeCursor.slice(lastAtIndex + 1);
        if (!/\s/.test(queryCandidate)) {
          this.mentionQuery.set(queryCandidate);
          this.isMentionPickerOpen.set(true);
          this.mentionSelectedIndex.set(0);
          return;
        }
      }
    }

    this.isMentionPickerOpen.set(false);
  }

  selectMention(
    candidate: MentionCandidate,
    val: string,
    inputEl: HTMLInputElement | undefined
  ): string {
    const cursorPos = inputEl?.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const textAfterCursor = val.slice(cursorPos);

    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const prefix = val.slice(0, lastAtIndex);
      const mentionDisplayName = candidate.isAll ? 'all' : candidate.name.split(' ')[0];
      const mentionText = `@${mentionDisplayName} `;
      const newText = prefix + mentionText + textAfterCursor;

      if (!this.mentionedUids().includes(candidate.uid)) {
        this.mentionedUids.set([...this.mentionedUids(), candidate.uid]);
      }

      this.isMentionPickerOpen.set(false);

      queueMicrotask(() => {
        if (inputEl) {
          const newCursorPos = lastAtIndex + mentionText.length;
          inputEl.setSelectionRange(newCursorPos, newCursorPos);
          inputEl.focus();
        }
      });

      return newText;
    }

    return val;
  }

  handleKeydown(event: KeyboardEvent, candidates: MentionCandidate[], selectCallback: (c: MentionCandidate) => void): boolean {
    if (!this.isMentionPickerOpen() || candidates.length === 0) {
      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.mentionSelectedIndex.set((this.mentionSelectedIndex() + 1) % candidates.length);
      return true;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.mentionSelectedIndex.set((this.mentionSelectedIndex() - 1 + candidates.length) % candidates.length);
      return true;
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const selected = candidates[this.mentionSelectedIndex()];
      if (selected) {
        selectCallback(selected);
      }
      return true;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.isMentionPickerOpen.set(false);
      return true;
    }

    return false;
  }

  filterValidMentions(messageText: string, candidates: MentionCandidate[]): string[] {
    return this.mentionedUids().filter((uid) => {
      if (uid === 'all') return messageText.includes('@all');
      const p = candidates.find((item) => item.uid === uid);
      if (!p) return messageText.includes('@');
      const firstName = p.name.split(' ')[0];
      return messageText.includes(`@${firstName}`) || (p.username && messageText.includes(`@${p.username}`));
    });
  }

  clear() {
    this.mentionedUids.set([]);
    this.isMentionPickerOpen.set(false);
  }
}
