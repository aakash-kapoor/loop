import { Component, OnInit, OnDestroy, inject, signal, computed, effect } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { CallHistoryService, CallHistoryRecord } from '../../services/call-history.service';
import { LiveKitService } from '../../services/livekit.service';
import { ConversationService } from '../../services/conversation.service';
import { UserService } from '../../services/user.service';
import { Avatar } from '../../shared/avatar/avatar';
import { ConfirmModal } from '../../shared/confirm-modal/confirm-modal';
import { NewCallModal } from '../../shared/new-call-modal/new-call-modal';

export interface GroupedCallHistory {
  groupId: string; // targetUid_dateKey
  targetUid: string;
  displayName: string;
  photoURL?: string;
  convoId: string;
  dateLabel: string;
  records: CallHistoryRecord[];
  latestCall: CallHistoryRecord;
  totalCount: number;
  hasMissed: boolean;
  hasUnreadMissed: boolean;
}

@Component({
  selector: 'app-calls',
  standalone: true,
  imports: [NgClass, DatePipe, Avatar, ConfirmModal, NewCallModal],
  templateUrl: './calls.html',
  host: {
    class: 'flex flex-col flex-1 h-full w-full overflow-hidden bg-bg-main',
  },
})
export class CallsComponent implements OnInit, OnDestroy {
  public readonly auth = inject(Auth);
  public readonly callHistoryService = inject(CallHistoryService);
  public readonly userService = inject(UserService);
  private readonly liveKitService = inject(LiveKitService);
  private readonly conversationService = inject(ConversationService);
  private readonly router = inject(Router);

  readonly activeTab = signal<'all' | 'missed'>('all');
  readonly showClearConfirm = signal<boolean>(false);
  readonly showSingleDeleteConfirm = signal<string | null>(null);
  readonly showNewCallModal = signal<boolean>(false);
  readonly expandedGroupIds = signal<Set<string>>(new Set());
  readonly viewedGroupIds = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      const calls = this.callHistoryService.recentCalls();
      const uids = new Set<string>();
      calls.forEach((c) => {
        if (c.callerUid) uids.add(c.callerUid);
        if (c.receiverUid) uids.add(c.receiverUid);
        c.participantIds?.forEach((id) => uids.add(id));
      });
      if (uids.size > 0) {
        this.userService.fetchParticipantProfiles(Array.from(uids));
      }
    });
  }

  readonly filteredCalls = computed(() => {
    const list = this.callHistoryService.recentCalls();
    const tab = this.activeTab();

    if (tab === 'missed') {
      return list.filter((c) => c.status === 'missed' || c.status === 'declined');
    }
    return list;
  });

  isGroupCallRecord(call: CallHistoryRecord): boolean {
    return !!call.groupName || (call.participantIds?.length || 0) > 2;
  }

  getTargetUid(call: CallHistoryRecord): string {
    if (this.isGroupCallRecord(call)) {
      return call.convoId;
    }
    const currentUid = this.auth.currentUser()?.uid;
    if (!currentUid) return call.convoId;
    return call.callerUid === currentUid
      ? (call.receiverUid || call.participantIds?.find((id) => id !== currentUid) || call.convoId)
      : call.callerUid;
  }

  getDateKey(createdAtMs?: number): string {
    if (!createdAtMs) return 'today';
    const d = new Date(createdAtMs);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  }

  getDateLabel(createdAtMs?: number): string {
    if (!createdAtMs) return 'Today';
    const now = new Date();
    const target = new Date(createdAtMs);

    const isToday =
      now.getFullYear() === target.getFullYear() &&
      now.getMonth() === target.getMonth() &&
      now.getDate() === target.getDate();

    if (isToday) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      yesterday.getFullYear() === target.getFullYear() &&
      yesterday.getMonth() === target.getMonth() &&
      yesterday.getDate() === target.getDate();

    if (isYesterday) return 'Yesterday';

    const diffDays = Math.floor((now.getTime() - target.getTime()) / (1000 * 3600 * 24));
    if (diffDays < 7) {
      return target.toLocaleDateString(undefined, { weekday: 'long' });
    }

    return target.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  readonly groupedCalls = computed<GroupedCallHistory[]>(() => {
    const calls = this.filteredCalls();
    if (calls.length === 0) return [];

    const groupMap = new Map<string, CallHistoryRecord[]>();

    for (const call of calls) {
      const targetUid = this.getTargetUid(call);
      const ms = call.createdAtMs || (call.createdAt?.toDate ? call.createdAt.toDate().getTime() : Date.now());
      const dateKey = this.getDateKey(ms);
      const groupKey = `${targetUid}_${dateKey}`;

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, []);
      }
      groupMap.get(groupKey)!.push(call);
    }

    const result: GroupedCallHistory[] = [];

    for (const [groupKey, records] of groupMap.entries()) {
      records.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      const latestCall = records[0];
      const targetUid = this.getTargetUid(latestCall);
      const displayName = this.getCallDisplayName(latestCall);
      const photoURL = this.getCallDisplayPhoto(latestCall);
      const ms = latestCall.createdAtMs || (latestCall.createdAt?.toDate ? latestCall.createdAt.toDate().getTime() : Date.now());
      const dateLabel = this.getDateLabel(ms);
      const hasMissed = records.some((r) => r.status === 'missed' || r.status === 'declined');
      const isViewed = this.viewedGroupIds().has(groupKey);
      const hasUnreadMissed = hasMissed && !isViewed;

      result.push({
        groupId: groupKey,
        targetUid,
        displayName,
        photoURL,
        convoId: latestCall.convoId,
        dateLabel,
        records,
        latestCall,
        totalCount: records.length,
        hasMissed,
        hasUnreadMissed,
      });
    }

    return result.sort((a, b) => (b.latestCall.createdAtMs || 0) - (a.latestCall.createdAtMs || 0));
  });

  ngOnInit(): void {
    const user = this.auth.currentUser();
    if (user) {
      this.callHistoryService.listenForRecentCalls(user.uid);
    }
  }

  ngOnDestroy(): void {
    this.callHistoryService.unsubscribe();
  }

  goBack(): void {
    this.router.navigate(['/chats']);
  }

  setTab(tab: 'all' | 'missed'): void {
    this.activeTab.set(tab);
  }

  toggleAccordion(groupId: string, event?: Event): void {
    if (event) event.stopPropagation();
    this.expandedGroupIds.update((set) => {
      const next = new Set(set);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
        this.markGroupAsViewed(groupId);
      }
      return next;
    });
  }

  markGroupAsViewed(groupId: string): void {
    this.viewedGroupIds.update((set) => {
      if (set.has(groupId)) return set;
      const next = new Set(set);
      next.add(groupId);
      return next;
    });
  }

  isExpanded(groupId: string): boolean {
    return this.expandedGroupIds().has(groupId);
  }

  isOutgoing(call: CallHistoryRecord): boolean {
    return call.callerUid === this.auth.currentUser()?.uid;
  }

  getCallDisplayName(call: CallHistoryRecord): string {
    if (this.isGroupCallRecord(call)) {
      return call.groupName || 'Group Call';
    }
    const currentUid = this.auth.currentUser()?.uid;
    const isOut = this.isOutgoing(call);
    const targetUid = isOut 
      ? (call.receiverUid || call.participantIds?.find((id) => id !== currentUid)) 
      : call.callerUid;

    if (targetUid) {
      const cached = this.userService.usersCache()[targetUid];
      if (cached) {
        return cached.displayName || cached.username || 'User';
      }
    }

    if (isOut) {
      return call.receiverName && call.receiverName !== 'User' ? call.receiverName : 'User';
    }
    return call.callerName && call.callerName !== 'User' ? call.callerName : 'User';
  }

  getCallDisplayPhoto(call: CallHistoryRecord): string | undefined {
    if (this.isGroupCallRecord(call)) {
      return undefined;
    }
    const currentUid = this.auth.currentUser()?.uid;
    const isOut = this.isOutgoing(call);
    const targetUid = isOut 
      ? (call.receiverUid || call.participantIds?.find((id) => id !== currentUid)) 
      : call.callerUid;

    if (targetUid) {
      const cached = this.userService.usersCache()[targetUid];
      if (cached?.photoURL) {
        return cached.photoURL;
      }
    }

    return isOut ? call.receiverPhoto : call.callerPhoto;
  }

  async initiateCall(call: CallHistoryRecord, audioOnly: boolean): Promise<void> {
    if (!call.convoId) return;
    
    await this.conversationService.selectConversation(call.convoId);
    const convo = this.conversationService.selectedConversation();
    if (convo) {
      this.liveKitService.initiateCall(convo, audioOnly);
    } else {
      this.router.navigate(['/chats', call.convoId]);
    }
  }

  openClearConfirm(): void {
    this.showClearConfirm.set(true);
  }

  closeClearConfirm(): void {
    this.showClearConfirm.set(false);
  }

  async confirmClearAllHistory(): Promise<void> {
    await this.callHistoryService.clearAllCallHistory();
    this.closeClearConfirm();
  }

  openDeleteSingleConfirm(event: Event, callId?: string): void {
    event.stopPropagation();
    if (callId) {
      this.showSingleDeleteConfirm.set(callId);
    }
  }

  closeDeleteSingleConfirm(): void {
    this.showSingleDeleteConfirm.set(null);
  }

  async confirmDeleteSingleCall(): Promise<void> {
    const callId = this.showSingleDeleteConfirm();
    if (callId) {
      await this.callHistoryService.deleteCallRecord(callId);
    }
    this.closeDeleteSingleConfirm();
  }

  openNewCallModal(): void {
    this.showNewCallModal.set(true);
  }

  closeNewCallModal(): void {
    this.showNewCallModal.set(false);
  }

  openChat(convoId: string, groupId?: string): void {
    if (groupId) {
      this.markGroupAsViewed(groupId);
    }
    this.router.navigate(['/chats', convoId]);
  }

  startNewCall(): void {
    this.openNewCallModal();
  }
}
