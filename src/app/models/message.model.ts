export interface Message {
    id: string;
    senderId: string;
    text: string;
    createdAt: number;
    reactions?: Record<string, string[]>; // emoji -> uids
    replyTo?: string;
}