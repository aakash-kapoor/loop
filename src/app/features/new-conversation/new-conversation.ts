import { Component, inject, signal, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { UserService } from '../../services/user.service';
import { ConversationService } from '../../services/conversation.service';
import { Auth } from '../../core/auth';
import { AppUser } from '../../models/user.model';

@Component({
  selector: 'app-new-conversation',
  imports: [FormsModule, NgClass],
  templateUrl: './new-conversation.html',
  styleUrl: './new-conversation.scss',
})
export class NewConversation implements OnInit, OnDestroy {
  protected readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly searchQuery = signal<string>('');
  readonly searchResults = signal<AppUser[]>([]);
  readonly isSearching = signal<boolean>(false);
  readonly suggestedContacts = signal<AppUser[]>([]);
  readonly isLoadingSuggested = signal<boolean>(true);
  readonly isHistoryBased = signal<boolean>(false);

  // Group creation states
  readonly isGroupMode = signal<boolean>(false);
  readonly selectedUsers = signal<string[]>([]); // Array of UIDs
  readonly groupName = signal<string>('');
  readonly isCreatingGroup = signal<boolean>(false);

  private readonly searchSubject = new Subject<string>();
  private searchSubscription?: Subscription;

  constructor() {
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(async (queryVal) => {
      const cleaned = queryVal.trim();
      if (!cleaned) {
        this.searchResults.set([]);
        this.isSearching.set(false);
        return;
      }

      this.isSearching.set(true);
      try {
        const currentUid = this.auth.currentUser()?.uid;
        const results = await this.userService.searchUsersByUsername(cleaned, currentUid);
        this.searchResults.set(results);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        this.isSearching.set(false);
      }
    });
  }

  async ngOnInit() {
    await this.loadSuggestedContacts();
  }

  private async loadSuggestedContacts() {
    this.isLoadingSuggested.set(true);
    try {
      const recent = await this.conversationService.getRecentContacts();
      if (recent.length > 0) {
        this.suggestedContacts.set(recent);
        this.isHistoryBased.set(true);
      } else {
        const currentUid = this.auth.currentUser()?.uid;
        const suggested = await this.userService.getSuggestedUsers(currentUid);
        this.suggestedContacts.set(suggested);
        this.isHistoryBased.set(false);
      }
    } catch (err) {
      console.error('Failed to load suggested contacts:', err);
    } finally {
      this.isLoadingSuggested.set(false);
    }
  }

  ngOnDestroy() {
    this.searchSubscription?.unsubscribe();
  }

  onSearchChange(val: string) {
    this.searchQuery.set(val);
    const cleaned = val.trim();
    if (!cleaned) {
      this.searchResults.set([]);
      this.isSearching.set(false);
      return;
    }
    this.isSearching.set(true);
    this.searchSubject.next(cleaned);
  }

  readonly creationError = signal<string>('');

  async startDM(recipientUid: string) {
    this.creationError.set('');
    try {
      const id = await this.conversationService.startConversation(recipientUid);
      this.conversationService.selectConversation(id);
      this.router.navigate(['/chats', id]);
    } catch (err: any) {
      console.error('Failed to start DM:', err);
      if (err.message?.startsWith('E2EE_UPGRADE_REQUIRED:')) {
        const name = err.message.split(':')[1];
        this.creationError.set(`Cannot start chat: ${name} needs to update their application to support encryption.`);
      } else {
        this.creationError.set('Failed to start conversation. Please try again.');
      }
    }
  }

  toggleUserSelection(uid: string) {
    const current = this.selectedUsers();
    if (current.includes(uid)) {
      this.selectedUsers.set(current.filter((id) => id !== uid));
    } else {
      this.selectedUsers.set([...current, uid]);
      this.userService.fetchParticipantProfiles([uid]);
    }
  }

  async createGroup() {
    const name = this.groupName().trim();
    const uids = this.selectedUsers();
    
    if (!name || uids.length === 0 || this.isCreatingGroup()) return;

    this.isCreatingGroup.set(true);
    this.creationError.set('');
    try {
      const id = await this.conversationService.startGroupConversation(name, uids);
      this.conversationService.selectConversation(id);
      this.router.navigate(['/chats', id]);
    } catch (err: any) {
      console.error('Failed to create group:', err);
      if (err.message?.startsWith('E2EE_UPGRADE_REQUIRED:')) {
        const pName = err.message.split(':')[1];
        this.creationError.set(`Cannot create group: ${pName} needs to update their application to support encryption.`);
      } else {
        this.creationError.set('Failed to create group. Please try again.');
      }
    } finally {
      this.isCreatingGroup.set(false);
    }
  }

  toggleMode() {
    this.isGroupMode.set(!this.isGroupMode());
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.selectedUsers.set([]);
    this.groupName.set('');
    this.isSearching.set(false);
  }

  goBack() {
    this.router.navigate(['/chats']);
  }
}
