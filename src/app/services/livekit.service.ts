import { Injectable, signal, inject, computed } from '@angular/core';
import { Room, RoomEvent, RemoteTrack, RemoteParticipant, Participant, TrackPublication, VideoPresets } from 'livekit-client';
import { doc, setDoc, updateDoc, onSnapshot, deleteDoc, serverTimestamp, collection, query, where, getDoc, getDocs, limit } from 'firebase/firestore';
import { db } from '../core/firebase.config';
import { Auth } from '../core/auth';
import { Conversation } from '../models/conversation.model';
import { CallHistoryService } from './call-history.service';

export interface RemoteParticipantTrack {
  participantSid: string;
  identity: string;
  uid?: string;
  displayName?: string;
  username?: string;
  photoURL?: string;
  videoTrack?: RemoteTrack;
  audioTrack?: RemoteTrack;
  isVideoMuted?: boolean;
  isAudioMuted?: boolean;
  isSpeaking?: boolean;
}

export interface IncomingCall {
  callId: string;
  convoId: string;
  callerUid: string;
  callerName: string;
  callerPhoto?: string;
  groupName?: string;
  participantIds: string[];
  callType: 'audio' | 'video';
  status: 'ringing' | 'connected' | 'declined' | 'ended';
}

import { UserService } from './user.service';

@Injectable({
  providedIn: 'root',
})
export class LiveKitService {
  public readonly auth = inject(Auth);
  private readonly callHistoryService = inject(CallHistoryService);
  private readonly userService = inject(UserService);
  private room: Room | null = null;
  private workerUrl = 'https://livekit-token-worker.aakash-kapoor.workers.dev/';

  // Reactive state signals
  public isConnected = signal<boolean>(false);
  public isConnecting = signal<boolean>(false);
  public isAudioOnly = signal<boolean>(false);
  public isMicMuted = signal<boolean>(false);
  public isCameraOff = signal<boolean>(false);
  public currentRoomName = signal<string>('');
  public remoteParticipants = signal<RemoteParticipantTrack[]>([]);
  public localTrackPublishedSignal = signal<number>(0);

  // Call Signaling Signals
  public incomingCall = signal<IncomingCall | null>(null);
  public activeCallId = signal<string | null>(null);
  public activeCallInfo = signal<{ receiverName?: string; receiverPhoto?: string } | null>(null);
  public activeCallParticipantIds = signal<string[]>([]);
  public allGroupMembers = signal<string[]>([]);
  public callerUid = signal<string | null>(null);
  public activeConvoType = signal<'dm' | 'group' | null>(null);
  public readonly isGroupCall = computed(() => this.activeConvoType() === 'group');
  private activeCallUnsub?: () => void;
  private callSignalingUnsub?: () => void;
  private ringTimeoutTimer?: any;
  private ringtoneAudio?: HTMLAudioElement;
  public callStartTime = signal<number | null>(null);
  private callInfoForHistory?: {
    convoId: string;
    callerUid: string;
    callerName: string;
    callerPhoto?: string;
    receiverUid?: string;
    receiverName?: string;
    receiverPhoto?: string;
    groupName?: string;
    participantIds: string[];
    callType: 'audio' | 'video';
  };

  constructor() {}

  /**
   * Play incoming call ringtone audio
   */
  public playIncomingRingtone(): void {
    this.stopRingtone();
    try {
      this.ringtoneAudio = new Audio('/assets/sounds/ringtone.mp3');
      this.ringtoneAudio.loop = true;
      this.ringtoneAudio.volume = 0.85;

      this.ringtoneAudio.onerror = () => {
        if (this.ringtoneAudio && !this.ringtoneAudio.src.includes('mixkit')) {
          this.ringtoneAudio.src = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';
          this.ringtoneAudio.play().catch(() => {});
        }
      };

      this.ringtoneAudio.play().catch((err) => {
        console.warn('[LiveKitService] Ringtone audio playback prevented by browser:', err);
      });
    } catch (e) {
      console.warn('[LiveKitService] Ringtone initialization failed:', e);
    }
  }

  /**
   * Stop ringtone audio
   */
  public stopRingtone(): void {
    if (this.ringtoneAudio) {
      try {
        this.ringtoneAudio.pause();
        this.ringtoneAudio.currentTime = 0;
      } catch (e) {}
      this.ringtoneAudio = undefined;
    }
  }

  /**
   * Listen for incoming calls for the current logged-in user across Firestore
   */
  public listenForIncomingCalls(currentUid: string): void {
    if (this.callSignalingUnsub) return;

    // Listen to user's personal call signal document
    const userCallRef = doc(db, 'userCalls', currentUid);
    this.callSignalingUnsub = onSnapshot(
      userCallRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as IncomingCall;
          if (data.status === 'ringing' && data.callerUid !== currentUid) {
            if (!this.incomingCall()) {
              this.playIncomingRingtone();
            }
            this.incomingCall.set(data);
            return;
          }
        }
        this.stopRingtone();
        this.incomingCall.set(null);
      },
      (error) => {
        console.warn('[LiveKitService] userCall listener error:', error);
      }
    );
  }

  /**
   * Stop listening for incoming calls (e.g. on logout)
   */
  public stopListeningForIncomingCalls(): void {
    if (this.callSignalingUnsub) {
      this.callSignalingUnsub();
      this.callSignalingUnsub = undefined;
    }
    this.stopRingtone();
    this.incomingCall.set(null);
  }

  /**
   * Initiate a call and notify all conversation participants via Firestore
   */
  async initiateCall(convo: Conversation, audioOnly: boolean = false): Promise<void> {
    const currentUser = this.auth.currentUser();
    if (!currentUser) return;

    const convoId = convo.id;
    const callerName = currentUser.displayName || currentUser.username || 'User';
    const callerPhoto = currentUser.photoURL || '';
    const participantIds = convo.participants || [];

    const isGroup = convo.type === 'group' || participantIds.length > 2;
    let receiverName = isGroup ? (convo.groupName || 'Group Call') : 'User';
    let receiverPhoto = isGroup ? (convo.groupIcon || '') : '';
    let receiverUid: string | undefined = undefined;

    if (!isGroup) {
      receiverUid = participantIds.find((id) => id !== currentUser.uid);
      if (receiverUid) {
        const userProfile = await this.userService.getUserProfile(receiverUid);
        if (userProfile) {
          receiverName = userProfile.displayName || userProfile.username || receiverName;
          receiverPhoto = userProfile.photoURL || receiverPhoto;
        }
      }
    }

    this.activeCallId.set(convoId);
    this.activeCallInfo.set({ receiverName, receiverPhoto });
    this.activeCallParticipantIds.set([...participantIds]);
    this.allGroupMembers.set([...participantIds]);
    this.callerUid.set(currentUser.uid);
    this.activeConvoType.set(isGroup ? 'group' : 'dm');
    this.callInfoForHistory = {
      convoId,
      callerUid: currentUser.uid,
      callerName,
      callerPhoto,
      receiverUid,
      receiverName,
      receiverPhoto,
      groupName: isGroup ? (convo.groupName || 'Group Call') : undefined,
      participantIds,
      callType: audioOnly ? 'audio' : 'video',
    };

    // 1. Create active call signal for all remote participants
    const callData: IncomingCall = {
      callId: convoId,
      convoId: convoId,
      callerUid: currentUser.uid,
      callerName: callerName,
      callerPhoto: callerPhoto,
      groupName: isGroup ? (convo.groupName || 'Group Call') : undefined,
      participantIds: participantIds,
      callType: audioOnly ? 'audio' : 'video',
      status: 'ringing',
    };

    try {
      // 1. Set active call document FIRST so it is guaranteed to exist in Firestore before recipients receive signals
      const roomCallRef = doc(db, 'calls', convoId);
      await setDoc(roomCallRef, {
        ...callData,
        createdAt: serverTimestamp(),
      });

      // 2. Notify all participants (except caller) by updating their userCall documents
      for (const pId of participantIds) {
        if (pId !== currentUser.uid) {
          await setDoc(doc(db, 'userCalls', pId), {
            ...callData,
            createdAt: serverTimestamp(),
          });
        }
      }

      // 3. Listen for room status updates (e.g. if call is declined or ended)
      this.listenToActiveCall(convoId);

      // 4. Start 30s ringing timeout
      this.startRingingTimeout(convoId);
    } catch (e) {
      console.warn('[LiveKitService] Failed to set call signal in Firestore:', e);
    }

    // 5. Start LiveKit WebRTC connection for caller with unique currentUser.uid identity
    await this.startCall(convoId, currentUser.uid, audioOnly);
  }

  /**
   * Listen for status updates or deletion of the active call in Firestore
   */
  private listenToActiveCall(convoId: string): void {
    if (this.activeCallUnsub) {
      this.activeCallUnsub();
      this.activeCallUnsub = undefined;
    }

    let hasBeenConnected = false;

    const roomCallRef = doc(db, 'calls', convoId);
    this.activeCallUnsub = onSnapshot(
      roomCallRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          // In 1-on-1 calls, trigger leaveCall if active call doc is removed
          if (!this.isGroupCall() && (hasBeenConnected || this.isConnected())) {
            console.log('[LiveKitService] Active 1-on-1 call doc removed, leaving call');
            this.clearRingingTimeout();
            this.leaveCall();
          }
          return;
        }

        const data = snapshot.data();
        const status = data?.['status'];

        if (status === 'connected') {
          hasBeenConnected = true;
          if (!this.callStartTime()) {
            this.callStartTime.set(Date.now());
          }
          this.clearRingingTimeout();
        } else if (status === 'ended') {
          console.log('[LiveKitService] Call ended, leaving call');
          this.clearRingingTimeout();
          this.leaveCall();
        } else if ((status === 'declined' || status === 'missed') && !this.isGroupCall()) {
          console.log('[LiveKitService] 1-on-1 Call status is', status, ', leaving call');
          this.clearRingingTimeout();
          this.leaveCall();
        }
      },
      (error) => {
        console.warn('[LiveKitService] roomCall listener error:', error);
      }
    );
  }

  /**
   * Accept an incoming call
   */
  async acceptIncomingCall(): Promise<void> {
    this.stopRingtone();
    const call = this.incomingCall();
    const currentUser = this.auth.currentUser();
    if (!call || !currentUser) return;

    try {
      // Clear user incoming call notification signal
      await deleteDoc(doc(db, 'userCalls', currentUser.uid)).catch(() => {});
      this.incomingCall.set(null);

      // Merge room call status to connected
      await setDoc(doc(db, 'calls', call.convoId), { status: 'connected' }, { merge: true });
      this.activeCallId.set(call.convoId);
      this.activeCallInfo.set({ receiverName: call.callerName, receiverPhoto: call.callerPhoto });
      this.activeCallParticipantIds.set([...(call.participantIds || [])]);
      this.allGroupMembers.set([...(call.participantIds || [])]);
      if (call.convoId) {
        getDoc(doc(db, 'conversations', call.convoId)).then((snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data['participants'])) {
              this.allGroupMembers.set(data['participants']);
            }
          }
        }).catch(() => {});
      }
      this.callerUid.set(call.callerUid);
      this.activeConvoType.set((call.participantIds?.length || 0) > 2 || !!call.groupName ? 'group' : 'dm');
      this.callInfoForHistory = {
        convoId: call.convoId,
        callerUid: call.callerUid,
        callerName: call.callerName,
        callerPhoto: call.callerPhoto,
        groupName: call.groupName,
        participantIds: call.participantIds,
        callType: call.callType,
      };
      this.callStartTime.set(Date.now());

      // Listen for room status updates
      this.listenToActiveCall(call.convoId);

      // Join LiveKit WebRTC room with unique currentUser.uid identity
      await this.startCall(call.convoId, currentUser.uid, call.callType === 'audio');
    } catch (e) {
      console.error('[LiveKitService] Failed to accept call:', e);
      this.leaveCall();
    }
  }

  /**
   * Decline an incoming call
   */
  async declineIncomingCall(): Promise<void> {
    this.stopRingtone();
    const call = this.incomingCall();
    const currentUser = this.auth.currentUser();
    if (!call || !currentUser) return;

    if (call) {
      this.callHistoryService.logCallRecord({
        convoId: call.convoId,
        callerUid: call.callerUid,
        callerName: call.callerName,
        callerPhoto: call.callerPhoto,
        participantIds: call.participantIds,
        callType: call.callType,
        status: 'declined',
        durationSeconds: 0,
      });
    }

    // Clear user call signal
    await deleteDoc(doc(db, 'userCalls', currentUser.uid)).catch(() => {});
    this.incomingCall.set(null);

    // Notify room that call was declined ONLY if 1-on-1 call (prevents 1 user from killing ongoing group call)
    const isGroup = (call.participantIds?.length || 0) > 2 || !!call.groupName;
    if (!isGroup) {
      await setDoc(doc(db, 'calls', call.convoId), { status: 'declined' }, { merge: true }).catch(() => {});
    }
  }

  /**
   * Connect directly to LiveKit Room
   */
  async startCall(roomName: string, username: string, audioOnly: boolean = false): Promise<void> {
    if (this.isConnecting() || this.isConnected()) return;

    this.isConnecting.set(true);
    this.isAudioOnly.set(audioOnly);
    this.currentRoomName.set(roomName);

    try {
      const requestUrl = `${this.workerUrl}?room=${encodeURIComponent(roomName)}&username=${encodeURIComponent(username)}`;
      const response = await fetch(requestUrl);
      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to fetch LiveKit token');
      }

      const { token, wsUrl } = data;

      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
      });

      this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: TrackPublication, participant: RemoteParticipant) => {
        this.handleTrackUpdate(participant, track, 'add');
      });

      this.room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: TrackPublication, participant: RemoteParticipant) => {
        this.handleTrackUpdate(participant, track, 'remove');
      });

      this.room.on(RoomEvent.TrackMuted, (publication: TrackPublication, participant: Participant) => {
        if (publication.kind === 'video' || publication.kind === 'audio') {
          this.handleTrackMute(participant, publication.kind, true);
        }
      });

      this.room.on(RoomEvent.TrackUnmuted, (publication: TrackPublication, participant: Participant) => {
        if (publication.kind === 'video' || publication.kind === 'audio') {
          this.handleTrackMute(participant, publication.kind, false);
        }
      });

      this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const speakerSids = new Set(speakers.map((s) => s.sid));
        this.remoteParticipants.update((list) =>
          list.map((p) => ({
            ...p,
            isSpeaking: speakerSids.has(p.participantSid),
          }))
        );
      });

      this.room.on(RoomEvent.LocalTrackPublished, () => {
        this.localTrackPublishedSignal.update((n) => n + 1);
      });

      this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        this.handleParticipantJoined(participant);
      });

      this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        this.handleParticipantDisconnected(participant);
      });

      this.room.on(RoomEvent.Disconnected, () => {
        this.cleanup();
      });

      await this.room.connect(wsUrl, token);
      this.isConnected.set(true);
      this.isConnecting.set(false);

      // Populate remote participants who are already in the room upon joining
      this.room.remoteParticipants.forEach((participant) => {
        this.handleParticipantJoined(participant);
      });

      try {
        await this.room.localParticipant.setMicrophoneEnabled(true);
      } catch (micErr) {
        console.warn('[LiveKitService] Microphone access busy or blocked:', micErr);
        this.isMicMuted.set(true);
      }

      if (!audioOnly) {
        try {
          await this.room.localParticipant.setCameraEnabled(true);
        } catch (camErr) {
          console.warn('[LiveKitService] Camera access busy or blocked:', camErr);
          this.isCameraOff.set(true);
        }
      } else {
        this.isCameraOff.set(true);
      }
    } catch (err) {
      console.error('[LiveKitService] Call Error:', err);
      this.cleanup();
      throw err;
    }
  }

  attachLocalVideo(element: HTMLVideoElement): boolean {
    if (!this.room) return false;
    const publications = Array.from(this.room.localParticipant.videoTrackPublications.values());
    for (const pub of publications) {
      if (pub.track) {
        pub.track.attach(element);
        return true;
      }
    }
    return false;
  }

  async toggleMicrophone(): Promise<void> {
    if (!this.room) return;
    const enabled = this.room.localParticipant.isMicrophoneEnabled;
    await this.room.localParticipant.setMicrophoneEnabled(!enabled);
    this.isMicMuted.set(enabled);
  }

  async toggleCamera(): Promise<void> {
    if (!this.room) return;
    const enabled = this.room.localParticipant.isCameraEnabled;
    await this.room.localParticipant.setCameraEnabled(!enabled);
    this.isCameraOff.set(enabled);
    if (!enabled && this.isAudioOnly()) {
      this.isAudioOnly.set(false);
    }
  }

  async leaveCall(): Promise<void> {
    const activeId = this.activeCallId();
    const currentUser = this.auth.currentUser();

    if (this.activeCallUnsub) {
      this.activeCallUnsub();
      this.activeCallUnsub = undefined;
    }

    if (this.callInfoForHistory && currentUser) {
      const info = this.callInfoForHistory;
      const start = this.callStartTime();
      const durationSeconds = start ? Math.max(1, Math.floor((Date.now() - start) / 1000)) : 0;
      const status = start ? 'completed' : 'missed';

      if (currentUser.uid === info.callerUid) {
        this.callHistoryService.logCallRecord({
          convoId: info.convoId,
          callerUid: info.callerUid,
          callerName: info.callerName,
          callerPhoto: info.callerPhoto,
          groupName: info.groupName,
          participantIds: info.participantIds,
          callType: info.callType,
          status: status,
          durationSeconds: durationSeconds,
        });
      }
      this.callInfoForHistory = undefined;
      this.callStartTime.set(null);
    }

    if (activeId) {
      try {
        if (!this.isGroupCall() || this.remoteParticipants().length === 0) {
          await updateDoc(doc(db, 'calls', activeId), { status: 'ended' }).catch(() => {});
          await deleteDoc(doc(db, 'calls', activeId)).catch(() => {});

          for (const pId of this.activeCallParticipantIds()) {
            await deleteDoc(doc(db, 'userCalls', pId)).catch(() => {});
          }
        }
        if (currentUser) {
          await deleteDoc(doc(db, 'userCalls', currentUser.uid)).catch(() => {});
        }
      } catch (e) {
        // Ignore if already deleted
      }
    }

    if (this.room) {
      try {
        await this.room.disconnect();
      } catch (e) {
        // Ignore disconnect error
      }
    }
    this.cleanup();
  }

  private handleParticipantJoined(participant: RemoteParticipant): void {
    this.remoteParticipants.update((list) => {
      let existing = list.find((p) => p.participantSid === participant.sid);
      if (!existing) {
        // identity is the user's UID (passed as currentUser.uid to startCall)
        existing = { participantSid: participant.sid, identity: participant.identity, uid: participant.identity };
        list = [...list, existing];
      }
      return [...list];
    });

    if (participant.identity) {
      this.userService.fetchParticipantProfiles([participant.identity]);

      const applyProfile = (name: string, uname: string, photo?: string) => {
        this.remoteParticipants.update((currentList) => {
          const target = currentList.find((p) => p.participantSid === participant.sid);
          if (target) {
            if (photo) target.photoURL = photo;
            target.displayName = name;
            target.username = uname;
          }
          return [...currentList];
        });
      };

      const cached = this.userService.usersCache()[participant.identity];
      if (cached) {
        applyProfile(
          cached.displayName || cached.username || participant.identity,
          cached.username || participant.identity,
          cached.photoURL
        );
      } else {
        // Query user document by UID
        getDoc(doc(db, 'users', participant.identity)).then((snap) => {
          if (snap.exists()) {
            const data = snap.data();
            applyProfile(
              data['displayName'] || data['username'] || participant.identity,
              data['username'] || participant.identity,
              data['photoURL']
            );
          } else {
            // Fallback query by usernameLower
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('usernameLower', '==', participant.identity.toLowerCase()), limit(1));
            getDocs(q).then((querySnap) => {
              if (!querySnap.empty) {
                const data = querySnap.docs[0].data();
                applyProfile(
                  data['displayName'] || data['username'] || participant.identity,
                  data['username'] || participant.identity,
                  data['photoURL']
                );
              }
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    }

    participant.trackPublications.forEach((pub) => {
      if (pub.track && pub.isSubscribed) {
        this.handleTrackUpdate(participant, pub.track as RemoteTrack, 'add');
      }
    });
  }

  private handleTrackUpdate(participant: RemoteParticipant, track: RemoteTrack, action: 'add' | 'remove'): void {
    this.remoteParticipants.update((list) => {
      let existing = list.find((p) => p.participantSid === participant.sid);
      if (!existing) {
        existing = { participantSid: participant.sid, identity: participant.identity, uid: participant.identity };
        const incoming = this.incomingCall();
        if (incoming && incoming.callerName === participant.identity && incoming.callerPhoto) {
          existing.photoURL = incoming.callerPhoto;
        }
        list = [...list, existing];
      }

      if (!existing.displayName && participant.identity) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('usernameLower', '==', participant.identity.toLowerCase()), limit(1));
        getDocs(q).then((snap) => {
          if (!snap.empty) {
            const data = snap.docs[0].data();
            const photo = data?.['photoURL'];
            const name = data?.['displayName'] || data?.['username'] || participant.identity;
            const uname = data?.['username'] || participant.identity;

            this.remoteParticipants.update((currentList) => {
              const target = currentList.find((p) => p.participantSid === participant.sid);
              if (target) {
                if (photo) target.photoURL = photo;
                target.displayName = name;
                target.username = uname;
              }
              return [...currentList];
            });
          }
        }).catch(() => {});
      }

      if (track.kind === 'video') {
        existing.videoTrack = action === 'add' ? track : undefined;
        existing.isVideoMuted = action === 'add' ? track.isMuted : false;
      } else if (track.kind === 'audio') {
        existing.audioTrack = action === 'add' ? track : undefined;
        existing.isAudioMuted = action === 'add' ? track.isMuted : false;
      }

      return [...list];
    });
  }

  private handleTrackMute(participant: Participant, kind: 'video' | 'audio', isMuted: boolean): void {
    this.remoteParticipants.update((list) => {
      const existing = list.find((p) => p.participantSid === participant.sid);
      if (existing) {
        if (kind === 'video') existing.isVideoMuted = isMuted;
        if (kind === 'audio') existing.isAudioMuted = isMuted;
      }
      return [...list];
    });
  }

  private handleParticipantDisconnected(participant: RemoteParticipant): void {
    this.remoteParticipants.update((list) => list.filter((p) => p.participantSid !== participant.sid));
    if (this.remoteParticipants().length === 0 && this.isConnected()) {
      console.log('[LiveKitService] All remote participants disconnected, ending call');
      this.leaveCall();
    }
  }

  private startRingingTimeout(convoId: string): void {
    this.clearRingingTimeout();
    this.ringTimeoutTimer = setTimeout(async () => {
      console.log('[LiveKitService] Ringing timed out after 30s with no answer');
      try {
        await setDoc(doc(db, 'calls', convoId), { status: 'missed' }, { merge: true }).catch(() => {});
      } catch (e) {}
      this.leaveCall();
    }, 30000);
  }

  private clearRingingTimeout(): void {
    if (this.ringTimeoutTimer) {
      clearTimeout(this.ringTimeoutTimer);
      this.ringTimeoutTimer = undefined;
    }
  }
  /**
   * Invite a group member to join the active call mid-call
   */
  async inviteParticipant(uid: string): Promise<void> {
    const activeId = this.activeCallId();
    if (!activeId || !this.callInfoForHistory) return;

    const info = this.callInfoForHistory;
    const callData: IncomingCall = {
      callId: activeId,
      convoId: activeId,
      callerUid: info.callerUid,
      callerName: info.callerName,
      callerPhoto: info.callerPhoto,
      participantIds: this.activeCallParticipantIds(),
      callType: info.callType,
      status: 'ringing',
    };

    try {
      await setDoc(doc(db, 'userCalls', uid), {
        ...callData,
        createdAt: serverTimestamp(),
      });

      // Add to participant IDs if not already present
      const current = this.activeCallParticipantIds();
      if (!current.includes(uid)) {
        this.activeCallParticipantIds.set([...current, uid]);
      }
    } catch (e) {
      console.warn('[LiveKitService] Failed to invite participant:', e);
    }
  }

  /**
   * Remove a participant from the active call via server-side kick
   */
  async removeParticipant(identity: string, uid: string): Promise<void> {
    const roomName = this.currentRoomName();
    if (!roomName) return;

    try {
      const requestUrl = `${this.workerUrl}?action=remove_participant&room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`;
      const response = await fetch(requestUrl);
      if (!response.ok) {
        console.warn('[LiveKitService] Worker remove_participant failed:', await response.text());
      }
    } catch (e) {
      console.warn('[LiveKitService] Failed to call remove_participant endpoint:', e);
    }

    // Clean up Firestore signal for the removed user
    await deleteDoc(doc(db, 'userCalls', uid)).catch(() => {});
  }

  /**
   * Ping (re-ring) a participant who hasn't joined the call yet
   */
  async pingParticipant(uid: string): Promise<void> {
    const activeId = this.activeCallId();
    if (!activeId || !this.callInfoForHistory) return;

    const info = this.callInfoForHistory;
    const callData: IncomingCall = {
      callId: activeId,
      convoId: activeId,
      callerUid: info.callerUid,
      callerName: info.callerName,
      callerPhoto: info.callerPhoto,
      participantIds: this.activeCallParticipantIds(),
      callType: info.callType,
      status: 'ringing',
    };

    try {
      // Atomic overwrite with pingAt to guarantee onSnapshot fires
      await setDoc(doc(db, 'userCalls', uid), {
        ...callData,
        pingAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('[LiveKitService] Failed to ping participant:', e);
    }
  }

  private cleanup(): void {
    this.stopRingtone();
    this.clearRingingTimeout();
    if (this.activeCallUnsub) {
      this.activeCallUnsub();
      this.activeCallUnsub = undefined;
    }
    this.room = null;
    this.activeCallId.set(null);
    this.activeCallInfo.set(null);
    this.activeCallParticipantIds.set([]);
    this.allGroupMembers.set([]);
    this.callerUid.set(null);
    this.activeConvoType.set(null);
    this.callStartTime.set(null);
    this.callInfoForHistory = undefined;
    this.isConnected.set(false);
    this.isConnecting.set(false);
    this.isAudioOnly.set(false);
    this.isMicMuted.set(false);
    this.isCameraOff.set(false);
    this.currentRoomName.set('');
    this.remoteParticipants.set([]);
  }
}
