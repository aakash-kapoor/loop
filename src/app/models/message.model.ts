export interface MessageAttachment {
    url: string;
    fileName: string;
    fileSize: number;
    fileType: 'image' | 'document' | 'video' | 'audio' | 'other';
    mimeType: string;
    storagePath?: string;
}

export interface MessageCallLog {
    callType: 'audio' | 'video';
    status: 'completed' | 'missed' | 'declined';
    durationSeconds: number;
    callerUid: string;
    callerName: string;
}

export interface Message {
    id: string;
    senderId: string;
    text: string;
    createdAt: any;        // Firestore Timestamp, used by rules
    createdAtMs?: number;  // client-side ms fallback
    reactions?: Record<string, string[]>; // emoji -> uids
    replyTo?: string;
    deletedFor?: string[];        // uids who have deleted this specific message
    deletedForEveryone?: boolean; // true — wiped for all participants
    encryptionVersion?: number;   // version tag for E2EE messages
    mentions?: string[];          // array of mentioned user UIDs
    seenBy?: string[];            // UIDs who have read this message (read receipts)
    attachments?: MessageAttachment[];
    forwardedFrom?: string;       // source message ID — present only on forwarded copies (cosmetic only)
    callLog?: MessageCallLog;
}