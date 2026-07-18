import { Component, inject, signal, OnDestroy } from '@angular/core';
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
export class NewConversation implements OnDestroy {
  protected readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly searchQuery = signal<string>('');
  readonly searchResults = signal<AppUser[]>([]);
  readonly isSearching = signal<boolean>(false);

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

  async startDM(recipientUid: string) {
    try {
      const id = await this.conversationService.startConversation(recipientUid);
      this.conversationService.selectConversation(id);
      this.router.navigate(['/chats', id]);
    } catch (err) {
      console.error('Failed to start DM:', err);
    }
  }

  toggleUserSelection(uid: string) {
    const current = this.selectedUsers();
    if (current.includes(uid)) {
      this.selectedUsers.set(current.filter((id) => id !== uid));
    } else {
      this.selectedUsers.set([...current, uid]);
    }
  }

  async createGroup() {
    const name = this.groupName().trim();
    const uids = this.selectedUsers();
    
    if (!name || uids.length === 0 || this.isCreatingGroup()) return;

    this.isCreatingGroup.set(true);
    try {
      const id = await this.conversationService.startGroupConversation(name, uids);
      this.conversationService.selectConversation(id);
      this.router.navigate(['/chats', id]);
    } catch (err) {
      console.error('Failed to create group:', err);
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
