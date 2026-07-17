import { Component, inject, computed } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly authService = inject(Auth);

  // App is loading while the initial authentication state is unresolved (undefined)
  readonly isLoading = computed(() => this.authService.currentUser() === undefined);
}
