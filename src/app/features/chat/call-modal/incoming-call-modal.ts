import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LiveKitService } from '../../../services/livekit.service';

@Component({
  selector: 'app-incoming-call-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './incoming-call-modal.html'
})
export class IncomingCallModalComponent {
  public liveKitService = inject(LiveKitService);
}
