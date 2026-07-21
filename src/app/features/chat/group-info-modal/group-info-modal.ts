import { Component, Input, Output, EventEmitter, inject, signal, computed, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Conversation } from '../../../models/conversation.model';
import { AppUser } from '../../../models/user.model';
import { ConversationService } from '../../../services/conversation.service';
import { UserService } from '../../../services/user.service';
import { Auth } from '../../../core/auth';
import { Avatar } from '../../../shared/avatar/avatar';
import { ConfirmModal } from '../../../shared/confirm-modal/confirm-modal';

@Component({
  selector: 'app-group-info-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, Avatar, ConfirmModal],
  templateUrl: './group-info-modal.html',
})
export class GroupInfoModal implements OnInit {
  readonly conversationSignal = signal<Conversation | null>(null);

  @Input({ required: true }) set conversation(val: Conversation) {
    this.conversationSignal.set(val);
    if (val?.participants?.length) {
      this.userService.fetchParticipantProfiles(val.participants);
    }
  }
  get conversation(): Conversation {
    return this.conversationSignal()!;
  }

  @Output() close = new EventEmitter<void>();

  private readonly conversationService = inject(ConversationService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth);

  ngOnInit() {
    const convo = this.conversationSignal();
    if (convo?.participants?.length) {
      this.userService.fetchParticipantProfiles(convo.participants);
    }
  }

  closeOnBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.activeMemberMenuId()) return;
    const target = event.target as HTMLElement;
    const isMemberMenuBtn = target.closest('.member-menu-btn');
    const isMemberMenuPopup = target.closest('.member-menu-popup');
    if (!isMemberMenuBtn && !isMemberMenuPopup) {
      this.activeMemberMenuId.set(null);
    }
  }

  readonly isEditingName = signal<boolean>(false);
  readonly editedName = signal<string>('');
  readonly isAddMembersOpen = signal<boolean>(false);
  readonly userSearchQuery = signal<string>('');
  readonly selectedUserIds = signal<string[]>([]);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly activeMemberMenuId = signal<string | null>(null);
  readonly activeConfirmAction = signal<'leave' | 'clear' | 'delete' | null>(null);

  readonly currentUserId = computed(() => this.auth.currentUser()?.uid);

  readonly isCurrentAdmin = computed(() => {
    const convo = this.conversationSignal();
    const uid = this.currentUserId();
    return !!uid && (convo?.admins?.includes(uid) ?? false);
  });

  readonly isCurrentCreator = computed(() => {
    const convo = this.conversationSignal();
    const uid = this.currentUserId();
    return !!uid && convo?.creatorId === uid;
  });

  readonly members = computed(() => {
    const convo = this.conversationSignal();
    if (!convo) return [];

    const cache = this.userService.usersCache();
    const currentUser = this.auth.currentUser();

    // Ensure profiles are subscribed for all current participants
    this.userService.fetchParticipantProfiles(convo.participants);

    return convo.participants.map((uid) => {
      const isSelf = uid === currentUser?.uid;
      const user = cache[uid] || (isSelf && currentUser ? currentUser : null) || {
        uid,
        username: isSelf && currentUser?.username ? currentUser.username : 'user',
        usernameLower: isSelf && currentUser?.usernameLower ? currentUser.usernameLower : 'user',
        displayName: isSelf && currentUser?.displayName ? currentUser.displayName : 'Loading...',
        photoURL: isSelf ? currentUser?.photoURL : undefined,
        isOnline: isSelf ? true : false,
        lastSeen: isSelf && currentUser ? currentUser.lastSeen : 0,
      };
      const isAdmin = convo.admins?.includes(uid) ?? false;
      const isCreator = convo.creatorId === uid;
      return { ...user, isAdmin, isCreator };
    });
  });

  readonly searchResults = signal<AppUser[]>([]);

  async onSearchUsers() {
    const queryStr = this.userSearchQuery().trim();
    if (!queryStr) {
      this.searchResults.set([]);
      return;
    }
    try {
      const results = await this.userService.searchUsersByUsername(queryStr, this.currentUserId());
      // Filter out users who are already in the group
      const existing = this.conversation.participants;
      this.searchResults.set(results.filter((u) => !existing.includes(u.uid)));
    } catch (err) {
      console.error('Search users error:', err);
    }
  }

  toggleUserSelection(uid: string) {
    const current = this.selectedUserIds();
    if (current.includes(uid)) {
      this.selectedUserIds.set(current.filter((id) => id !== uid));
    } else {
      this.selectedUserIds.set([...current, uid]);
    }
  }

  startEditingName() {
    this.editedName.set(this.conversation.groupName || '');
    this.isEditingName.set(true);
  }

  cancelEditingName() {
    this.isEditingName.set(false);
  }

  async saveName() {
    const name = this.editedName().trim();
    if (!name) return;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      await this.conversationService.updateGroupDetails(this.conversation.id, name);
      this.isEditingName.set(false);
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to update group name');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async confirmAddMembers() {
    const uids = this.selectedUserIds();
    if (!uids.length) return;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      await this.conversationService.addMembersToGroup(this.conversation.id, uids);
      this.isAddMembersOpen.set(false);
      this.selectedUserIds.set([]);
      this.userSearchQuery.set('');
      this.searchResults.set([]);
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to add members');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  toggleMemberMenu(uid: string) {
    if (this.activeMemberMenuId() === uid) {
      this.activeMemberMenuId.set(null);
    } else {
      this.activeMemberMenuId.set(uid);
    }
  }

  async promoteMember(uid: string) {
    this.activeMemberMenuId.set(null);
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      await this.conversationService.promoteAdmin(this.conversation.id, uid);
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to promote member');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async demoteMember(uid: string) {
    this.activeMemberMenuId.set(null);
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      await this.conversationService.demoteAdmin(this.conversation.id, uid);
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to demote member');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async removeMember(uid: string) {
    this.activeMemberMenuId.set(null);
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      await this.conversationService.removeMemberFromGroup(this.conversation.id, uid);
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to remove member');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openConfirm(action: 'leave' | 'clear' | 'delete') {
    this.activeConfirmAction.set(action);
  }

  closeConfirm() {
    this.activeConfirmAction.set(null);
  }

  async handleConfirm() {
    const action = this.activeConfirmAction();
    if (!action) return;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      if (action === 'leave') {
        await this.conversationService.leaveGroup(this.conversation.id);
        this.closeConfirm();
        this.close.emit();
      } else if (action === 'clear') {
        await this.conversationService.clearChatForMe();
        this.closeConfirm();
        this.close.emit();
      } else if (action === 'delete') {
        await this.conversationService.deleteGroupForEveryone(this.conversation.id);
        this.closeConfirm();
        this.close.emit();
      }
    } catch (err: any) {
      this.errorMessage.set(err.message || `Failed to ${action} group`);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
