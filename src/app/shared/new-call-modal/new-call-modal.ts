import { Component, Output, EventEmitter, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { UserService } from '../../services/user.service';
import { ConversationService } from '../../services/conversation.service';
import { LiveKitService } from '../../services/livekit.service';
import { Auth } from '../../core/auth';
import { AppUser } from '../../models/user.model';
import { Avatar } from '../avatar/avatar';

@Component({
  selector: 'app-new-call-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, Avatar],
  templateUrl: './new-call-modal.html',
})
export class NewCallModal implements OnInit, OnDestroy {
  @Output() close = new EventEmitter<void>();

  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);
  private readonly liveKitService = inject(LiveKitService);
  private readonly auth = inject(Auth);

  readonly searchQuery = signal<string>('');
  readonly searchResults = signal<AppUser[]>([]);
  readonly isSearching = signal<boolean>(false);
  readonly recentContacts = signal<AppUser[]>([]);
  readonly isLoadingRecent = signal<boolean>(true);
  readonly startingCallUid = signal<string | null>(null);

  private readonly searchSubject = new Subject<string>();
  private searchSubscription?: Subscription;

  ngOnInit(): void {
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(250),
      distinctUntilChanged()
    ).subscribe(query => {
      this.performSearch(query);
    });

    this.loadRecentContacts();
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
  }

  onSearchChange(query: string): void {
    this.searchQuery.set(query);
    if (!query.trim()) {
      this.searchResults.set([]);
      this.isSearching.set(false);
      return;
    }
    this.isSearching.set(true);
    this.searchSubject.next(query);
  }

  private async performSearch(queryStr: string): Promise<void> {
    const currentUid = this.auth.currentUser()?.uid;
    try {
      const results = await this.userService.searchUsersByUsername(queryStr, currentUid);
      this.searchResults.set(results);
    } catch (err) {
      console.warn('[NewCallModal] Search failed:', err);
    } finally {
      this.isSearching.set(false);
    }
  }

  private async loadRecentContacts(): Promise<void> {
    const currentUid = this.auth.currentUser()?.uid;
    if (!currentUid) return;

    this.isLoadingRecent.set(true);
    const convos = this.conversationService.conversations();
    const contactUids: string[] = [];

    convos.forEach(c => {
      if (c.type === 'dm') {
        const otherUid = c.participants.find(p => p !== currentUid);
        if (otherUid && !contactUids.includes(otherUid)) {
          contactUids.push(otherUid);
        }
      }
    });

    if (contactUids.length > 0) {
      this.userService.fetchParticipantProfiles(contactUids);
      const profiles: AppUser[] = [];
      for (const uid of contactUids) {
        const p = await this.userService.getUserProfile(uid);
        if (p) profiles.push(p);
      }
      this.recentContacts.set(profiles);
    }
    this.isLoadingRecent.set(false);
  }

  async startCallWithUser(user: AppUser, audioOnly: boolean): Promise<void> {
    const currentUid = this.auth.currentUser()?.uid;
    if (!currentUid) return;

    this.startingCallUid.set(user.uid);
    try {
      let convoId = '';
      const convos = this.conversationService.conversations();
      const existing = convos.find(
        (c) => c.type === 'dm' && c.participants.includes(user.uid) && c.participants.includes(currentUid)
      );

      if (existing) {
        convoId = existing.id;
      } else {
        convoId = await this.conversationService.startConversation(user.uid);
      }

      await this.conversationService.selectConversation(convoId);
      const convo = this.conversationService.selectedConversation();
      if (convo) {
        await this.liveKitService.initiateCall(convo, audioOnly);
        this.close.emit();
      }
    } catch (err) {
      console.error('[NewCallModal] Failed to start call:', err);
    } finally {
      this.startingCallUid.set(null);
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }
}
