import { Component } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './terms.html',
})
export class TermsComponent {
  lastUpdated = 'July 2026';

  constructor(private location: Location) {}

  goBack() {
    this.location.back();
  }
}
