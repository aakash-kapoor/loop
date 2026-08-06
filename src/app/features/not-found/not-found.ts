import { Component, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './not-found.html',
  host: {
    class: 'block h-full w-full min-h-screen overflow-hidden',
  },
})
export class NotFoundComponent {
  private readonly location = inject(Location);

  goBack() {
    this.location.back();
  }
}
