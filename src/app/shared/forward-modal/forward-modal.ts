import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  computed,
  signal,
  HostListener,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { ConversationService } from '../../services/conversation.service';
import { UserService } from '../../services/user.service';
import { Auth } from '../../core/auth';
import { Message } from '../../models/message.model';
import { Conversation } from '../../models/conversation.model';
import { Avatar } from '../avatar/avatar';

@Component({
  selector: 'app-forward-modal',
  imports: [FormsModule, NgClass, Avatar],
  templateUrl: './forward-modal.html',
})
export class ForwardModal {
  private readonly conversationService = inject(ConversationService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth);
  private readonly elementRef = inject(ElementRef);

  @Input({ required: true }) message!: Message;

  /** Emitted with the selected Conversation when the user confirms a forward. */
  @Output() forward = new EventEmitter<Conversation>();

  /** Emitted when the user dismisses the modal without forwarding. */
  @Output() close = new EventEmitter<void>();

  readonly filterQuery = signal<string>('');
  readonly isForwarding = signal<boolean>(false);
  readonly didSucceed = signal<boolean>(false);
  readonly forwardError = signal<string | null>(null);
  readonly selectedConvo = signal<Conversation | null>(null);

  private readonly currentUserId = computed(() => this.auth.currentUser()?.uid);
  private readonly currentConvoId = computed(
    () => this.conversationService.selectedConversationId()
  );

  /** Conversations eligible to forward into:
   *  - user must be a participant
   *  - not the currently-open conversation
   *  - not a pending request (forwarding into an unaccepted queue is confusing)
   *  - not soft-deleted for this user
   */
  readonly eligibleConversations = computed<Conversation[]>(() => {
    const uid = this.currentUserId();
    const activeId = this.currentConvoId();
    const query = this.filterQuery().toLowerCase().trim();
    const cache = this.userService.usersCache();

    return this.conversationService
      .conversations()
      .filter((c) => {
        if (c.id === activeId) return false;
        if (c.isPending) return false;
        if (c.deletedForEveryone) return false;
        if (uid && c.deletedFor?.includes(uid)) return false;
        return true;
      })
      .filter((c) => {
        if (!query) return true;
        const label = this.conversationLabel(c).toLowerCase();
        return label.includes(query);
      });
  });

  conversationLabel(c: Conversation): string {
    const uid = this.currentUserId();
    if (c.type === 'group') return c.groupName || 'Group';
    const partnerId = c.participants.find((p) => p !== uid);
    if (!partnerId) return 'Unknown';
    const partner = this.userService.usersCache()[partnerId];
    return partner?.displayName || partner?.username || 'Unknown';
  }

  conversationPhotoURL(c: Conversation): string | undefined {
    const uid = this.currentUserId();
    if (c.type === 'group') return c.groupIcon;
    const partnerId = c.participants.find((p) => p !== uid);
    if (!partnerId) return undefined;
    return this.userService.usersCache()[partnerId]?.photoURL;
  }

  selectConvo(c: Conversation) {
    this.selectedConvo.set(c);
    this.forwardError.set(null);
  }

  async confirmForward() {
    const target = this.selectedConvo();
    if (!target || this.isForwarding()) return;

    this.isForwarding.set(true);
    this.forwardError.set(null);

    try {
      this.forward.emit(target);
      // The parent handles the actual service call and signals success back via
      // didSucceed. We optimistically show success here once emitted and rely
      // on the parent to call close() or handle the error.
    } catch (err: any) {
      this.forwardError.set(err.message || 'Failed to forward message.');
      this.isForwarding.set(false);
    }
  }

  /** Called by the parent ChatView after a successful forwardMessage() call. */
  markSuccess() {
    this.didSucceed.set(true);
    this.isForwarding.set(false);
  }

  /** Called by the parent ChatView if forwardMessage() throws. */
  markError(message: string) {
    this.forwardError.set(message);
    this.isForwarding.set(false);
  }

  @HostListener('keydown.escape')
  onEscape() {
    if (!this.isForwarding()) this.close.emit();
  }

  onBackdropClick(event: MouseEvent) {
    if (!this.isForwarding()) this.close.emit();
  }
}
