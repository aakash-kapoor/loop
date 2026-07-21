import { Component } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './privacy.html',
})
export class PrivacyComponent {
  lastUpdated = 'July 2026';

  constructor(private location: Location) {}

  goBack() {
    this.location.back();
  }
}
