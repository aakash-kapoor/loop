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
}