export interface Conversation {
    id: string;
    type: 'dm' | 'group';
    participants: string[];
    groupName?: string;
    groupIcon?: string;
    initiatedBy?: string;      // present until recipient replies
    isPending: boolean;        // true = message request
    lastMessage: string;
    lastMessageAt: number;
    unreadCount: Record<string, number>;
    deletedFor?: string[];        // uids who have "deleted" this conversation
    clearedAt?: Record<string, number>; // uid -> timestamp, hides messages before this time
    lastMessageEncryptionVersion?: number; // version tag for E2EE previews
}