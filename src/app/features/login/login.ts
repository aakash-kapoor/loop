import { Component, inject, ElementRef, viewChild, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { animate } from 'motion';

@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements AfterViewInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  private readonly loginCard = viewChild<ElementRef<HTMLElement>>('loginCard');
  private readonly logo = viewChild<ElementRef<HTMLElement>>('logo');
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  private readonly desc = viewChild<ElementRef<HTMLElement>>('desc');
  private readonly actionBtn = viewChild<ElementRef<HTMLElement>>('actionBtn');

  ngAfterViewInit() {
    // Staggered entrance animations using Motion
    const cardEl = this.loginCard()?.nativeElement;
    const logoEl = this.logo()?.nativeElement;
    const titleEl = this.title()?.nativeElement;
    const descEl = this.desc()?.nativeElement;
    const btnEl = this.actionBtn()?.nativeElement;

    if (cardEl) {
      animate(cardEl, { opacity: [0, 1], y: [40, 0] }, { duration: 0.8, ease: 'easeOut' });
    }
    if (logoEl) {
      animate(logoEl, { scale: [0.5, 1], opacity: [0, 1] }, { duration: 0.6, delay: 0.2, ease: 'backOut' });
    }
    if (titleEl) {
      animate(titleEl, { opacity: [0, 1], y: [10, 0] }, { duration: 0.5, delay: 0.4 });
    }
    if (descEl) {
      animate(descEl, { opacity: [0, 1], y: [10, 0] }, { duration: 0.5, delay: 0.5 });
    }
    if (btnEl) {
      animate(btnEl, { opacity: [0, 1], y: [10, 0] }, { duration: 0.5, delay: 0.6 });
    }
  }

  async signIn() {
    try {
      await this.auth.loginWithGoogle();
      this.router.navigate(['/']);
    } catch (error) {
      console.error('Sign-in failed:', error);
    }
  }
}
