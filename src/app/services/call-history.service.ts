import { Injectable, inject, signal } from '@angular/core';
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  setDoc,
  addDoc,
  serverTimestamp,
  limit,
  updateDoc,
  arrayUnion,
  writeBatch
} from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { Auth } from '../core/auth';

export interface CallHistoryRecord {
  id?: string;
  convoId: string;
  callerUid: string;
  callerName: string;
  callerPhoto?: string;
  receiverUid?: string;
  receiverName?: string;
  receiverPhoto?: string;
  groupName?: string;
  participantIds: string[];
  callType: 'audio' | 'video';
  status: 'completed' | 'missed' | 'declined';
  durationSeconds: number;
  createdAt?: any;
  createdAtMs?: number;
  deletedFor?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class CallHistoryService {
  private readonly auth = inject(Auth);

  public recentCalls = signal<CallHistoryRecord[]>([]);
  public missedCallsCount = signal<number>(0);

  private callHistoryUnsub?: () => void;

  /**
   * Log a completed, missed, or declined call to Firestore and write inline chat event message
   */
  async logCallRecord(record: Omit<CallHistoryRecord, 'id' | 'createdAt'>): Promise<void> {
    const currentUser = this.auth.currentUser();
    if (!currentUser) return;

    const nowMs = Date.now();
    const callRecordData: any = {
      ...record,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
    };

    // Remove undefined properties for Firestore compatibility
    Object.keys(callRecordData).forEach((key) => {
      if (callRecordData[key] === undefined) {
        delete callRecordData[key];
      }
    });

    try {
      // 1. Save to callHistory collection using deterministic ID to prevent duplicate call records
      const timeWindow = Math.floor(nowMs / 15000);
      const recordId = `${record.convoId}_${timeWindow}`;
      await setDoc(doc(db, 'callHistory', recordId), callRecordData, { merge: true });

      // 2. Log inline message into conversation timeline ONLY if current user is the caller (prevents duplicate chat bubbles)
      if (currentUser.uid === record.callerUid) {
        const statusText = record.status === 'completed' 
          ? `Call ended • ${this.formatDuration(record.durationSeconds)}`
          : record.status === 'declined' 
          ? 'Call declined' 
          : 'Missed call';

        const callMessageData = {
          senderId: 'system',
          text: statusText,
          callLog: {
            callType: record.callType,
            status: record.status,
            durationSeconds: record.durationSeconds,
            callerUid: record.callerUid,
            callerName: record.callerName,
          },
          createdAt: serverTimestamp(),
          createdAtMs: nowMs,
          seenBy: [currentUser.uid],
        };

        await addDoc(collection(db, 'conversations', record.convoId, 'messages'), callMessageData);

        // Update conversation lastMessage preview
        const lastMsgPreview = record.status === 'completed'
          ? `${record.callType === 'video' ? '📹 Video call' : '📞 Audio call'} (${this.formatDuration(record.durationSeconds)})`
          : `${record.callType === 'video' ? '📹 Missed video call' : '📞 Missed audio call'}`;

        await updateDoc(doc(db, 'conversations', record.convoId), {
          lastMessage: lastMsgPreview,
          lastMessageAt: nowMs,
          lastMessageEncryptionVersion: 2,
          lastMessageIsSystem: true,
          lastMessageSenderId: 'system',
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn('[CallHistoryService] Failed to log call record:', err);
    }
  }

  /**
   * Listen to user's recent calls across all conversations
   */
  listenForRecentCalls(userUid: string): void {
    if (this.callHistoryUnsub) return;

    const historyRef = collection(db, 'callHistory');
    const q = query(
      historyRef,
      where('participantIds', 'array-contains', userUid),
      limit(50)
    );

    this.callHistoryUnsub = onSnapshot(
      q,
      (snapshot) => {
        const records: CallHistoryRecord[] = [];
        let missedCount = 0;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as CallHistoryRecord;
          const rec: CallHistoryRecord = { ...data, id: docSnap.id };
          if (!rec.deletedFor?.includes(userUid)) {
            records.push(rec);
            if (rec.status === 'missed' && rec.callerUid !== userUid) {
              missedCount++;
            }
          }
        });

        records.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || Date.now());
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || Date.now());
          return tB - tA;
        });

        this.recentCalls.set(records);
        this.missedCallsCount.set(missedCount);
      },
      (err) => {
        console.warn('[CallHistoryService] callHistory listener error:', err);
      }
    );
  }

  /**
   * Stop listening for call history
   */
  unsubscribe(): void {
    if (this.callHistoryUnsub) {
      this.callHistoryUnsub();
      this.callHistoryUnsub = undefined;
    }
  }

  /**
   * Delete a single call record for current user
   */
  async deleteCallRecord(callId: string): Promise<void> {
    const currentUser = this.auth.currentUser();
    if (!currentUser || !callId) return;

    try {
      const docRef = doc(db, 'callHistory', callId);
      await updateDoc(docRef, {
        deletedFor: arrayUnion(currentUser.uid),
      });
    } catch (err) {
      console.warn('[CallHistoryService] Failed to delete call record:', err);
    }
  }

  /**
   * Clear all call history for current user
   */
  async clearAllCallHistory(): Promise<void> {
    const currentUser = this.auth.currentUser();
    if (!currentUser) return;

    const currentCalls = this.recentCalls();
    if (currentCalls.length === 0) return;

    try {
      const batch = writeBatch(db);
      currentCalls.forEach((call) => {
        if (call.id) {
          const docRef = doc(db, 'callHistory', call.id);
          batch.update(docRef, {
            deletedFor: arrayUnion(currentUser.uid),
          });
        }
      });
      await batch.commit();
    } catch (err) {
      console.warn('[CallHistoryService] Failed to clear call history:', err);
    }
  }

  /**
   * Format duration seconds to human-readable string (e.g. 4m 12s, 35s)
   */
  formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }
}
