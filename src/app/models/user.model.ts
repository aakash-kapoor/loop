export interface AppUser {
    uid: string;
    username: string;
    usernameLower: string;   // for case-insensitive search
    displayName: string;
    photoURL?: string;
    isOnline: boolean;
    lastSeen: number;
    publicKey?: string;      // JWK public key format
}