import { Injectable, signal, computed } from '@angular/core';
import { Message } from '../models/message.model';

@Injectable({
  providedIn: 'root',
})
export class ChatSearchService {
  readonly isSearchOpen = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly currentMatchIndex = signal<number>(0);
  readonly activeHighlightedMessageId = signal<string | null>(null);

  private highlightTimeout?: ReturnType<typeof setTimeout>;

  getMatchingMessages(messages: Message[], currentUid: string | null | undefined): Message[] {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return [];

    return messages.filter(
      (m) =>
        m.text &&
        !m.deletedForEveryone &&
        !m.deletedFor?.includes(currentUid || '') &&
        m.text.toLowerCase().includes(query)
    );
  }

  getCurrentMatch(matchingMessages: Message[]): Message | null {
    const idx = this.currentMatchIndex();
    if (matchingMessages.length === 0 || idx < 0 || idx >= matchingMessages.length) return null;
    return matchingMessages[idx];
  }

  toggleSearch(focusCallback?: () => void) {
    if (this.isSearchOpen()) {
      this.closeSearch();
    } else {
      this.isSearchOpen.set(true);
      if (focusCallback) {
        queueMicrotask(focusCallback);
      }
    }
  }

  closeSearch() {
    this.isSearchOpen.set(false);
    this.searchQuery.set('');
    this.currentMatchIndex.set(0);
    this.activeHighlightedMessageId.set(null);
    clearTimeout(this.highlightTimeout);
  }

  nextMatch(matches: Message[], scrollToCallback?: (id: string) => void) {
    if (matches.length === 0) return;
    const nextIdx = (this.currentMatchIndex() + 1) % matches.length;
    this.currentMatchIndex.set(nextIdx);
    if (scrollToCallback) {
      scrollToCallback(matches[nextIdx].id);
    }
  }

  prevMatch(matches: Message[], scrollToCallback?: (id: string) => void) {
    if (matches.length === 0) return;
    const prevIdx = (this.currentMatchIndex() - 1 + matches.length) % matches.length;
    this.currentMatchIndex.set(prevIdx);
    if (scrollToCallback) {
      scrollToCallback(matches[prevIdx].id);
    }
  }

  highlightAndScrollTo(messageId: string, scrollToElementCallback?: (id: string) => void) {
    clearTimeout(this.highlightTimeout);
    this.activeHighlightedMessageId.set(messageId);
    if (scrollToElementCallback) {
      scrollToElementCallback(messageId);
    }
    this.highlightTimeout = setTimeout(() => {
      if (this.activeHighlightedMessageId() === messageId) {
        this.activeHighlightedMessageId.set(null);
      }
    }, 2500);
  }

  clearHighlightTimeout() {
    clearTimeout(this.highlightTimeout);
  }
}
