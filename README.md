# 💬 Loop — Secure Real-Time Messaging App

Loop is a modern, responsive, end-to-end encrypted (E2EE) real-time messaging application built with **Angular 21**, **Tailwind CSS v4**, and **Firebase**. It provides a sleek, glassmorphic chat experience tailored for both desktop and mobile devices.

---

## ✨ Features

### 🔒 End-to-End Encryption (E2EE)
- **Zero-Knowledge Architecture**: All private chats and group messages are encrypted client-side using Web Crypto API standards before reaching Firebase.
- **AES-GCM 256-Bit Encryption**: Every conversation generates a unique symmetric AES master key for message encryption.
- **RSA-OAEP Key Distribution**: Asymmetric key pairs (2048-bit RSA) securely encrypt and distribute AES group keys to each participant's envelope.
- **IndexedDB Private Key Storage**: User private keys reside securely in local browser IndexedDB storage and are never uploaded to the server unencrypted.
- **Encrypted Passphrase Backups**: Optional PBKDF2 (210,000 iterations) encrypted backups allow key restoration on new devices.
- **Self-Healing Key Distribution**: Automatic transactional recovery repairs missing or corrupt key envelopes on-the-fly.

### 💬 Chat & Messaging
- **Direct & Group Conversations**: Start 1-on-1 private DMs or create multi-user group chats with custom group icons.
- **Mobile Swipe-to-Reply**: Touch-optimized swipe gesture on mobile message bubbles with spring elasticity, direction lock to protect vertical scrolling, and haptic feedback.
- **Click-to-Scroll & Replied Message Flash**: Click any quoted reply preview or composer banner to smoothly scroll directly to the original message with a soft, Telegram-style background flash highlight.
- **Message Forwarding**: Forward text messages to other direct or group conversations via an interactive modal with instant search. Attachment-only messages forward as a placeholder.
- **Threaded Replies**: Quote and reply directly to specific messages with an inline preview block.
- **Rich Message Reactions**: Expressive emoji reactions with real-time sync across devices.
- **@Mentions**: Tag specific participants or `@everyone` / `@all` in group conversations.
- **Pinned Messages**: Pin important messages in a conversation with a quick-jump top banner.
- **Image & File Attachments**: Share compressed images with lightbox previews and document file downloads.
- **In-Chat Message Search**: Search through conversation history with keyboard shortcuts (`Ctrl+F` / `Cmd+F`) and smooth match highlighting.
- **Delete for Everyone / Delete for Me**: Delete sent messages for all participants within a 15-minute window, or clear them locally at any time.
- **Message Requests**: Inbox protection for new contacts — DM requests require explicit acceptance before messages are delivered.
- **Conversation Draft Persistence**: Unsent message text auto-saves per conversation in local storage, restores automatically on return, and shows an amber **Draft** badge and preview in the sidebar.
- **Conversation Muting**: Mute specific chats with timed options (1 hour, 8 hours, or indefinitely) — suppresses both notifications and unread count badges with a visual bell-off indicator.

### 👤 User Presence & Profiles
- **Real-Time Online Presence**: Live online/offline status with smart staleness checks to prevent stale presence flags.
- **Typing Indicators**: Animated three-dot typing bubble with real-time sync across participants.
- **Read Receipts**: Double-tick read receipt indicators on outgoing messages, turning solid when seen by all participants.
- **Last Seen Privacy Controls**: User-configurable privacy settings to hide or display last seen timestamps.
- **Profile Editing**: Update display name and profile photo directly from Settings.
- **Username Claiming & User Search**: Discover users by unique handle with instant prefix searching and existing DM detection.

### 🔔 Notifications & Audio
- **In-Browser Push Notifications**: Desktop/mobile OS notifications with E2EE preview decryption.
- **Interactive Focus Navigation**: Click any native notification to jump directly into the active conversation thread.
- **Web Audio Ping Sweep**: Synthetic AudioContext pop-chime sound effect on new incoming messages.

### 🎨 Design & UI/UX
- **Responsive Dual-Pane Layout**: Split-screen sidebar/chat layout on desktop and focused single-panel view on mobile.
- **Dark Mode Support**: Seamless dark/light theme switching with zero flash on page load (FOUC prevention).
- **Glassmorphism & Micro-animations**: Frosted glass headers, smooth entry transitions, and tactile button press feedback.
- **Scroll-to-Bottom Button**: Floating scroll button with unread count badge appears when scrolled up in a conversation.
- **Instant Conversation Switching**: Stale messages cleared on conversation switch with a fade-in transition to eliminate layout jitter.

### 📱 Progressive Web App (PWA) & Automatic Updates
- **Offline Capabilities & Caching**: Powered by `@angular/service-worker` and `ngsw-config.json` for fast load times and offline application launch.
- **Automatic Deployment Detection**: Real-time `SwUpdate` listener automatically detects new Firebase Hosting deployments and prompts users to reload with a single tap.
- **Manual Cache Refresh**: Tap **Check for Updates** in Settings to manually verify server builds and flush stale service worker caches.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | ![Angular](https://img.shields.io/badge/Angular_21-DD0031?style=flat-square&logo=angular&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![RxJS](https://img.shields.io/badge/RxJS-B7178C?style=flat-square&logo=reactivex&logoColor=white) Standalone Components, Signals, RxJS Interop |
| **PWA & Offline** | ![Service Worker](https://img.shields.io/badge/Angular_PWA-DD0031?style=flat-square&logo=pwa&logoColor=white) `@angular/service-worker`, `ngsw-config.json`, Automatic Deployment Update Prompts |
| **Styling** | ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) ![SCSS](https://img.shields.io/badge/SCSS-CC6699?style=flat-square&logo=sass&logoColor=white) ![Tabler Icons](https://img.shields.io/badge/Tabler_Icons-1971C2?style=flat-square&logo=tabler&logoColor=white) |
| **Database & Auth** | ![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black) Firestore Real-Time Streams + Authentication (Google OAuth) |
| **Cryptography** | ![Web Crypto API](https://img.shields.io/badge/Web_Crypto_API-4285F4?style=flat-square&logo=googlechrome&logoColor=white) RSA-OAEP 2048-bit, AES-256-GCM, PBKDF2 |
| **Local Storage** | ![IndexedDB](https://img.shields.io/badge/IndexedDB-FF6B35?style=flat-square&logo=googlechrome&logoColor=white) ![LocalStorage](https://img.shields.io/badge/LocalStorage-F7DF1E?style=flat-square&logo=javascript&logoColor=black) |
| **Testing** | ![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white) ![JSDOM](https://img.shields.io/badge/JSDOM-323330?style=flat-square&logo=javascript&logoColor=F7DF1E) |

---

## 📁 Project Structure

```
src/app/
├── core/                  # Firebase initialization, Auth service, and core providers
│   ├── auth.ts            # Authentication state & presence manager
│   └── firebase.config.ts # Firebase SDK config & persistent offline cache
├── features/              # Feature modules & route components
│   ├── chat/              # Chat viewport, swipe-to-reply bubbles, search, group info modal
│   ├── choose-username/   # First-time onboarding & E2EE key generation
│   ├── conversation-list/ # Sidebar conversation feed & active chat item
│   ├── login/             # Google OAuth Sign-in interface
│   ├── new-conversation/  # User search, DM start, and group creation
│   ├── not-found/         # 404 Not Found error page
│   ├── privacy/           # Privacy policy page
│   ├── settings/          # Theme, notification, last-seen, & key backup preferences
│   ├── shell/             # App shell layout wrapper
│   └── terms/             # Terms of service page
├── models/                # TypeScript interfaces (Conversation, Message, User)
├── services/              # Domain services
│   ├── conversation.service.ts # Firestore conversation CRUD, muting & pinning
│   ├── crypto.service.ts       # Web Crypto API key generation, E2EE, and IndexedDB
│   ├── draft.service.ts        # LocalStorage unsent draft auto-persistence
│   ├── message.service.ts      # Message stream, E2EE encryption, forwarding, push alerts
│   ├── pwa.service.ts          # PWA service worker version listener & cache refresher
│   ├── toast.service.ts        # Global toast alert notification service
│   └── user.service.ts         # User profiles cache & username search
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