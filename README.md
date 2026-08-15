# 💬 Loop — Secure Real-Time Messaging & WebRTC Calling

[![Live Demo](https://img.shields.io/badge/Live_Demo-loop--realtime--chat.web.app-4F46E5?style=for-the-badge&logo=googlechrome&logoColor=white)](https://loop-realtime-chat.web.app/)
[![Case Study](https://img.shields.io/badge/Case_Study-Deep_Dive-06B6D4?style=for-the-badge&logo=readme&logoColor=white)](https://loop-realtime-chat.web.app/case-study)

> 🚀 **Live Demo**: [https://loop-realtime-chat.web.app/](https://loop-realtime-chat.web.app/)  
> 📖 **Technical Case Study**: [https://loop-realtime-chat.web.app/case-study](https://loop-realtime-chat.web.app/case-study)

Loop is a modern, responsive, end-to-end encrypted (E2EE) real-time messaging and multimedia communication application built with **Angular 21**, **LiveKit WebRTC SFU**, **Tailwind CSS v4**, and **Firebase**. It provides a sleek, glassmorphic experience tailored for high-performance desktop and mobile usage with zero-knowledge cryptographic privacy.

---

## ✨ Features

### 🔒 End-to-End Encryption (E2EE)
- **Zero-Knowledge Architecture**: All private chats and group messages are encrypted client-side using W3C Web Crypto API standards before reaching Firebase.
- **Hybrid AES-GCM 256-Bit Cryptography**: Every conversation generates a unique symmetric AES session key for fast, hardware-accelerated payload encryption.
- **RSA-OAEP Key Distribution**: Asymmetric key pairs (2048-bit RSA) securely wrap and distribute AES conversation keys to each recipient's envelope.
- **IndexedDB Private Key Storage**: User private keys reside securely in local browser IndexedDB storage and never touch the server unencrypted.
- **Zero-Knowledge Diceware Backups**: 6-word Diceware recovery phrase with PBKDF2 (100,000 iterations, SHA-256) derives an AES master key client-side for secure cross-device key restoration.
- **Self-Healing Key Distribution**: Automatic transactional recovery repairs missing or corrupt key envelopes on-the-fly.

### 📞 WebRTC Voice & Video Calling (LiveKit SFU)
- **Selective Forwarding Unit (SFU)**: High-definition opus audio and VP8/H.264 video streams routed via LiveKit SFU for $O(1)$ upstream bandwidth efficiency.
- **HD Video & Adaptive Bitrate**: High-definition video streams with dynamic resolution scaling and adaptive dynacast relaying.
- **Reactive Call Coordination**: Real-time incoming call modals, ringtone chimes, and instant accept/decline signaling powered by Firestore listeners.
- **Integrated In-Chat Call History**: Call durations, missed signals, and video/audio statuses automatically record into chat timelines with a one-click "Call back" action.
- **Active Speaker Detection**: Real-time audio waveform level visualization and speaker switching.

### 💬 Chat & Messaging
- **Direct & Group Conversations**: Start 1-on-1 private DMs or create multi-user group chats with custom group icons.
- **Mobile Swipe-to-Reply**: Touch-optimized swipe gesture on mobile message bubbles with spring elasticity, direction lock to protect vertical scrolling, and tactile feedback.
- **Click-to-Scroll & Replied Message Flash**: Click any quoted reply preview or composer banner to smoothly scroll directly to the original message with a soft background highlight.
- **Message Forwarding**: Forward text messages to other direct or group conversations via an interactive modal with instant search.
- **Threaded Replies & @Mentions**: Quote and reply directly to messages with inline preview blocks, and tag participants or `@everyone` in groups.
- **Rich Message Reactions**: Expressive emoji reactions with real-time sync across devices.
- **Pinned Messages**: Pin important messages in a conversation with a quick-jump top banner.
- **Canvas-Compressed Attachments**: Share images with client-side HTML5 Canvas compression (up to 70% bandwidth reduction) and lightbox previews.
- **In-Chat Message Search**: Search through conversation history with keyboard shortcuts (`Ctrl+F` / `Cmd+F`) and smooth match highlighting.
- **Delete for Everyone / Delete for Me**: Delete sent messages for all participants within a 15-minute window, or clear them locally at any time.
- **Message Requests**: Inbox protection for new contacts — DM requests require explicit acceptance before messages are delivered.
- **Conversation Draft Persistence**: Unsent message text auto-saves per conversation in local storage, restores automatically on return, and shows an amber **Draft** badge in the sidebar.
- **Conversation Muting**: Mute specific chats (1 hour, 8 hours, or indefinitely) to suppress notifications and badges.

### 👤 User Presence & Profiles
- **Real-Time Online Presence**: Live online/offline status with smart staleness checks.
- **Typing Indicators**: Animated three-dot typing bubble with real-time sync across participants.
- **Read Receipts**: Double-tick read receipt indicators turning solid when seen by all participants.
- **Last Seen Privacy Controls**: User-configurable privacy settings to hide or display last seen timestamps.
- **Profile Editing**: Update display name and profile photo directly from Settings.
- **Username Claiming & User Search**: Discover users by unique handle with instant prefix searching.

### 📖 Technical Case Study (`/case-study`)
- **Interactive WebCrypto E2EE Playground**: Live in-browser sandbox demonstrating real-time AES-GCM 256 + RSA-OAEP encryption, ciphertext generation, and key unwrapping.
- **Zero-Trust Message Lifecycle Diagram**: Visual 3-stage pipeline detailing sender isolation, untrusted cloud relay, and recipient decryption.
- **Architectural Trade-offs**: Deep dives into hybrid encryption, Diceware recovery, SFU vs. P2P Mesh scaling, and fine-grained Angular 21 Signals reactivity.
- **Production Code Snippets**: Inspectable TypeScript implementations with 1-click clipboard copying.

### 📱 Progressive Web App (PWA) & Automatic Updates
- **Offline Capabilities & Caching**: Powered by `@angular/service-worker` and `ngsw-config.json` for fast load times and offline application launch.
- **Automatic Deployment Detection**: Real-time `SwUpdate` listener automatically detects new Firebase deployments and prompts users to reload.
- **Manual Cache Refresh**: Tap **Check for Updates** in Settings to manually verify builds and flush stale service worker caches.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | ![Angular](https://img.shields.io/badge/Angular_21-DD0031?style=flat-square&logo=angular&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![RxJS](https://img.shields.io/badge/RxJS-B7178C?style=flat-square&logo=reactivex&logoColor=white) Standalone Components, Signals, RxJS Interop |
| **Real-Time WebRTC / SFU** | ![LiveKit](https://img.shields.io/badge/LiveKit_SFU-000000?style=flat-square&logo=webrtc&logoColor=white) `livekit-client`, Opus Audio, VP8/H.264 Video, Dynacast, Adaptive Streaming |
| **Cryptography** | ![Web Crypto API](https://img.shields.io/badge/Web_Crypto_API-4285F4?style=flat-square&logo=googlechrome&logoColor=white) W3C SubtleCrypto, RSA-OAEP 2048-bit, AES-256-GCM, PBKDF2 (100,000 rounds) |
| **Database & Auth** | ![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black) Firestore Real-Time Snapshot Streams + Authentication (Google OAuth) |
| **Styling & Animation** | ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) ![SCSS](https://img.shields.io/badge/SCSS-CC6699?style=flat-square&logo=sass&logoColor=white) ![Motion](https://img.shields.io/badge/Motion-0055FF?style=flat-square&logo=framer&logoColor=white) ![Tabler Icons](https://img.shields.io/badge/Tabler_Icons-1971C2?style=flat-square&logo=tabler&logoColor=white) |
| **PWA & Offline** | ![Service Worker](https://img.shields.io/badge/Angular_PWA-DD0031?style=flat-square&logo=pwa&logoColor=white) `@angular/service-worker`, `ngsw-config.json`, Automatic Deployment Update Prompts |
| **Local Storage** | ![IndexedDB](https://img.shields.io/badge/IndexedDB-FF6B35?style=flat-square&logo=googlechrome&logoColor=white) ![LocalStorage](https://img.shields.io/badge/LocalStorage-F7DF1E?style=flat-square&logo=javascript&logoColor=black) |
| **Testing** | ![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white) ![JSDOM](https://img.shields.io/badge/JSDOM-323330?style=flat-square&logo=javascript&logoColor=F7DF1E) |

---

## 📁 Project Structure

```
src/app/
├── core/                  # Firebase initialization, Auth service, and core providers
│   ├── auth.ts            # Authentication state & presence manager
│   ├── auth-guard.ts      # Route activation authentication guards
│   └── firebase.config.ts # Firebase SDK config & persistent offline cache
├── features/              # Feature modules & route components
│   ├── calls/             # Active LiveKit WebRTC voice/video call room & controls
│   ├── case-study/        # Architectural case study & interactive WebCrypto E2EE playground
│   ├── chat/              # Chat viewport, swipe-to-reply bubbles, search, group info modal
│   ├── choose-username/   # First-time onboarding & E2EE key generation
│   ├── conversation-list/ # Sidebar conversation feed & active chat item
│   ├── login/             # Google OAuth Sign-in interface & passphrase recovery
│   ├── new-conversation/  # User search, DM start, and group creation
│   ├── not-found/         # 404 Not Found error page
│   ├── privacy/           # Privacy policy page
│   ├── settings/          # Theme, notification, last-seen, & key backup preferences
│   ├── shell/             # App shell layout wrapper
│   └── terms/             # Terms of service page
├── models/                # TypeScript interfaces (Call, Conversation, Message, User)
├── services/              # Domain services
│   ├── attachment-upload.service.ts # Client-side image/document compression & upload
│   ├── call-history.service.ts      # Call logging & timeline persistence
│   ├── chat-search.service.ts       # In-chat message search & match highlighting
│   ├── conversation.service.ts      # Firestore conversation CRUD, muting & pinning
│   ├── crypto.service.ts            # Web Crypto API key generation, E2EE, and IndexedDB
│   ├── draft.service.ts             # LocalStorage unsent draft auto-persistence
│   ├── livekit.service.ts           # LiveKit SFU WebRTC room management & media tracks
│   ├── mention.service.ts           # @mention parsing & group participant autocomplete
│   ├── message.service.ts           # Message stream, E2EE encryption, forwarding, push alerts
│   ├── pwa.service.ts               # PWA service worker version listener & cache refresher
│   ├── toast.service.ts             # Global toast alert notification service
│   └── user.service.ts              # User profiles cache & username search
└── shared/                # Reusable UI components & utilities
    ├── avatar/            # Online status user & group avatars
    ├── confirm-modal/     # Confirmation modal dialogs
    ├── forward-modal/     # Interactive message forwarding modal
    ├── toast/             # Global toast alert component
    └── utils/             # Image compressor & canvas blob utilities
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18.x or higher
- **npm**: v9.x or higher

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/aakash-kapoor/loop.git
   cd loop
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment**:
   Create or update `src/environments/environment.ts` with your Firebase project credentials:
   ```typescript
   export const environment = {
     production: false,
     firebase: {
       apiKey: "YOUR_API_KEY",
       authDomain: "YOUR_PROJECT.firebaseapp.com",
       projectId: "YOUR_PROJECT_ID",
       storageBucket: "YOUR_PROJECT.firebasestorage.app",
       messagingSenderId: "YOUR_SENDER_ID",
       appId: "YOUR_APP_ID"
     }
   };
   ```

4. **Run Development Server**:
   ```bash
   npm start
   ```
   Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

---

## 🔐 Firestore Security Rules

Security rules are defined in [`firestore.rules`](./firestore.rules) at the project root. They enforce E2EE key envelope isolation, participant-only message access, and owner-only private subcollection reads.

Deploy them to your Firebase project using the Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

---

## 🧪 Running Tests

Run unit tests via [Vitest](https://vitest.dev/):
```bash
npm test
```

Build production bundle:
```bash
npm run build
```