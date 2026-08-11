import { Component, ElementRef, ViewChild, inject, effect, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LiveKitService } from '../../../services/livekit.service';
import { Auth } from '../../../core/auth';
import { UserService } from '../../../services/user.service';
import { AppUser } from '../../../models/user.model';

@Component({
  selector: 'app-call-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './call-modal.html'
})
export class CallModalComponent implements OnDestroy {
  public liveKitService = inject(LiveKitService);
  public readonly auth = inject(Auth);
  public readonly userService = inject(UserService);
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;

  readonly formattedCallDuration = signal<string>('00:00');
  readonly isFullscreen = signal<boolean>(false);
  readonly showParticipantsPanel = signal<boolean>(false);
  readonly isPiPSwapped = signal<boolean>(false);
  private timerInterval?: any;

  // Whether the current user is the call initiator (can remove participants)
  readonly isCaller = computed(() => {
    return this.liveKitService.callerUid() === this.auth.currentUser()?.uid;
  });

  readonly participantCount = computed(() => {
    if (!this.liveKitService.isConnected()) return 0;
    return 1 + this.liveKitService.remoteParticipants().length;
  });

  // UIDs of participants currently connected in the LiveKit room
  readonly connectedUids = computed(() => {
    const remotes = this.liveKitService.remoteParticipants();
    const uids = new Set<string>();
    remotes.forEach(p => {
      const uid = p.uid || p.identity;
      if (uid) uids.add(uid);
    });
    const currentUid = this.auth.currentUser()?.uid;
    if (currentUid) uids.add(currentUid);
    return uids;
  });

  // Group members who were invited but haven't joined (show Ping button)
  readonly absentParticipants = computed(() => {
    const allInvited = this.liveKitService.activeCallParticipantIds();
    const connected = this.connectedUids();
    const currentUid = this.auth.currentUser()?.uid;
    return allInvited.filter(uid => uid !== currentUid && !connected.has(uid));
  });

  // Profile data for absent participants from usersCache
  readonly absentProfiles = computed(() => {
    const absent = this.absentParticipants();
    const cache = this.userService.usersCache();
    return absent.map(uid => cache[uid]).filter((p): p is AppUser => !!p);
  });

  // Group conversation members not yet invited (show Invite button)
  // This requires knowing the full group member list - fetched from Firestore conversation doc
  readonly allGroupMembers = signal<string[]>([]);

  readonly invitableMembers = computed(() => {
    const allMembers = this.allGroupMembers();
    const alreadyInvited = new Set(this.liveKitService.activeCallParticipantIds());
    const currentUid = this.auth.currentUser()?.uid;
    return allMembers.filter(uid => uid !== currentUid && !alreadyInvited.has(uid));
  });

  readonly invitableProfiles = computed(() => {
    const invitable = this.invitableMembers();
    const cache = this.userService.usersCache();
    return invitable.map(uid => cache[uid]).filter((p): p is AppUser => !!p);
  });

  constructor() {
    effect(() => {
      const isConnected = this.liveKitService.isConnected();
      const startTime = this.liveKitService.callStartTime();

      if (isConnected && startTime) {
        this.startTimer(startTime);
      } else {
        this.stopTimer();
      }
    });

    effect(() => {
      const isConnected = this.liveKitService.isConnected();
      const isConnecting = this.liveKitService.isConnecting();
      const isCameraOff = this.liveKitService.isCameraOff();
      const _trackPubSignal = this.liveKitService.localTrackPublishedSignal();
      const _remotes = this.liveKitService.remoteParticipants();

      if ((isConnected || isConnecting) && !isCameraOff) {
        let attempts = 0;
        const tryAttach = () => {
          if (this.localVideoRef?.nativeElement) {
            const attached = this.liveKitService.attachLocalVideo(this.localVideoRef.nativeElement);
            if (!attached && attempts < 35) {
              attempts++;
              setTimeout(tryAttach, 150);
            }
          } else if (attempts < 35) {
            attempts++;
            setTimeout(tryAttach, 150);
          }
        };
        setTimeout(tryAttach, 50);
      }
    });

    effect(() => {
      const remotes = this.liveKitService.remoteParticipants();
      if (remotes.length > 0) {
        let attempts = 0;
        const tryAttachRemotes = () => {
          let allAttached = true;
          remotes.forEach(p => {
            if (p.videoTrack) {
              const videoEl = document.getElementById('remote-video-' + p.participantSid) as HTMLVideoElement;
              if (videoEl) {
                p.videoTrack.attach(videoEl);
              } else {
                allAttached = false;
              }
            }
            if (p.audioTrack) {
              const audioEl = document.getElementById('remote-audio-' + p.participantSid) as HTMLAudioElement;
              if (audioEl) {
                p.audioTrack.attach(audioEl);
              } else {
                allAttached = false;
              }
            }
          });

          if (!allAttached && attempts < 10) {
            attempts++;
            setTimeout(tryAttachRemotes, 200);
          }
        };
        setTimeout(tryAttachRemotes, 50);
      }
    });

    // When the panel is shown in a group call, fetch group member profiles
    effect(() => {
      if (this.showParticipantsPanel() && this.liveKitService.isGroupCall()) {
        const allIds = this.liveKitService.activeCallParticipantIds();
        const groupMembers = this.allGroupMembers();
        // Fetch profiles for all group members and invited participants
        const allUids = [...new Set([...allIds, ...groupMembers])];
        this.userService.fetchParticipantProfiles(allUids);
      }
    });

    // Auto-reset PiP swap when camera is turned off
    effect(() => {
      if (this.liveKitService.isCameraOff()) {
        this.isPiPSwapped.set(false);
      }
    });
  }

  onVideoMetadataLoaded(event: Event, participantSid: string): void {
    const video = event.target as HTMLVideoElement;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      const isPortrait = video.videoHeight > video.videoWidth;
      this.liveKitService.updateParticipantPortraitState(participantSid, isPortrait);
    }
  }

  toggleParticipantsPanel(): void {
    this.showParticipantsPanel.update(v => !v);
  }

  togglePiPSwap(): void {
    if (!this.liveKitService.isCameraOff()) {
      this.isPiPSwapped.update(v => !v);
    }
  }

  async onInviteParticipant(uid: string): Promise<void> {
    await this.liveKitService.inviteParticipant(uid);
  }

  async onRemoveParticipant(identity: string, uid: string): Promise<void> {
    await this.liveKitService.removeParticipant(identity, uid);
  }

  async onPingParticipant(uid: string): Promise<void> {
    await this.liveKitService.pingParticipant(uid);
  }

  setGroupMembers(members: string[]): void {
    this.allGroupMembers.set(members);
  }

  toggleFullScreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        this.isFullscreen.set(true);
      }).catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => {
          this.isFullscreen.set(false);
        }).catch(() => {});
      }
    }
  }

  private startTimer(startTime: number): void {
    this.stopTimer();
    const update = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const hrs = Math.floor(mins / 60);
      const displayMins = mins % 60;

      if (hrs > 0) {
        this.formattedCallDuration.set(
          `${hrs.toString().padStart(2, '0')}:${displayMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        );
      } else {
        this.formattedCallDuration.set(
          `${displayMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        );
      }
    };
    update();
    this.timerInterval = setInterval(update, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
    this.formattedCallDuration.set('00:00');
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }
}
