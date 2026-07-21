export interface AppUser {
    uid: string;
    username: string;
    usernameLower: string;   // for case-insensitive search
    displayName: string;
    photoURL?: string;
    isOnline: boolean;
    lastSeen: number;
    showLastSeen?: boolean;   // privacy preference: toggle visibility of last seen timestamp
    publicKey?: string;      // JWK public key format
}