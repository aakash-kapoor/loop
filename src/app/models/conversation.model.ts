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
    lastMessageIsSystem?: boolean; // true = plaintext system/event preview
    admins?: string[];             // group administrators
    creatorId?: string;           // creator of the group
    deletedForEveryone?: boolean; // soft-delete for everyone flag
    typing?: Record<string, number>; // uid → ms timestamp of last keystroke (ephemeral typing indicator)
    pinnedMessageId?: string | null; // ID of pinned message on conversation doc
    mutedBy?: string[];            // uids of users who muted this conversation (legacy array)
    mutedUntil?: Record<string, number>; // uid -> ms timestamp (-1 = indefinitely, > Date.now() = timed)
}

/** Check if a conversation is currently muted for a given user UID. */
export function isConvoMuted(convo: Conversation | null | undefined, uid: string | undefined): boolean {
    if (!convo || !uid) return false;
    const until = convo.mutedUntil?.[uid];
    if (until === -1) return true;
    if (typeof until === 'number' && until > Date.now()) return true;
    return convo.mutedBy?.includes(uid) ?? false;
}