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
}