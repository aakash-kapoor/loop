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
- **Direct & Group Conversations**: Start 1-on-1 private DMs or create multi-user group chats.
- **Message Requests**: Inbox protection for new contacts—DM requests require explicit acceptance.
- **Rich Message Reactions**: Expressive emoji reactions with real-time sync across devices.
- **@Mentions**: Tag specific participants or `@everyone` / `@all` in group conversations.
- **In-Chat Message Search**: Search through conversation history with keyboard shortcuts (`Ctrl+F` / `Cmd+F`) and smooth match highlighting.
- **15-Minute Soft Delete**: Delete sent messages for everyone within a 15-minute window, or clear chat history locally.
- **Threaded Replies**: Quote and reply directly to specific messages in a thread.

### 👤 User Presence & Profiles
- **Real-Time Online Presence**: Live online/offline status with smart 10-second grace periods for seamless tab switching.
- **Last Seen Privacy Controls**: User configurable privacy settings to hide or display last seen timestamps.
- **Username Claiming & User Search**: Discover users by unique handle with instant prefix searching.

### 🔔 Notifications & Audio
- **In-Browser Push Notifications**: Desktop/mobile OS notifications with E2EE preview decryption.
- **Interactive Focus Navigation**: Click any native notification to jump directly into the active conversation thread.
- **Web Audio Ping Sweep**: Synthetic AudioContext pop-chime sound effect on new incoming messages.

### 🎨 Design & UI/UX
- **Responsive Dual-Pane Layout**: Split-screen sidebar/chat layout on desktop displays and focused single-panel view on mobile screens.
- **Dark Mode Support**: Seamless dark/light theme switching with zero flash on page load (`FOUC` prevention).
- **Glassmorphism & Micro-animations**: Frosted glass headers, smooth entry transitions, and tactile button press feedback.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | ![Angular](https://img.shields.io/badge/Angular_21-DD0031?style=flat-square&logo=angular&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![RxJS](https://img.shields.io/badge/RxJS-B7178C?style=flat-square&logo=reactivex&logoColor=white) Standalone Components, Signals, RxJS Interop |
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
│   ├── chat/              # Main chat viewport, message bubbles, search, group info modal
│   ├── choose-username/   # First-time onboarding & E2EE key generation
│   ├── conversation-list/ # Sidebar conversation feed & active chat item
│   ├── login/             # Google OAuth Sign-in interface
│   ├── new-conversation/  # User search, DM start, and group creation
│   ├── privacy/           # Privacy policy page
│   ├── settings/          # Theme, notification, and privacy preferences
│   ├── shell/             # App shell layout wrapper
│   └── terms/             # Terms of service page
├── models/                # TypeScript interfaces (Conversation, Message, User)
├── services/              # Domain services
│   ├── conversation.service.ts # Firestore conversation CRUD & member management
│   ├── crypto.service.ts       # Web Crypto API key generation, E2EE, and IndexedDB
│   ├── message.service.ts      # Message stream, E2EE encryption/decryption, push alerts
│   └── user.service.ts         # User profiles cache & username search
└── shared/                # Reusable UI components (Avatar, ConfirmModal)
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
