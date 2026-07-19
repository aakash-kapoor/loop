import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-avatar',
  imports: [NgClass],
  templateUrl: './avatar.html',
})
export class Avatar {
  /** URL of the user's photo. If empty, falls back to initials. */
  @Input() photoURL?: string | null;

  /** Full display name used to generate initials fallback. */
  @Input() displayName?: string | null;

  /** Show green online indicator dot. */
  @Input() isOnline = false;

  /** 'round' for DM users, 'rounded' for groups. */
  @Input() shape: 'round' | 'rounded' = 'round';

  /** 'sm' = 32px (message bubble), 'md' = 40px (header / sidebar). */
  @Input() size: 'sm' | 'md' = 'md';

  /** When true, renders the group icon (ti-users) instead of photo/initials. */
  @Input() isGroup = false;

  get initials(): string {
    return this.displayName?.substring(0, 2) || 'U';
  }

  get sizeClass(): string {
    return this.size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  }

  get shapeClass(): string {
    return this.shape === 'rounded' ? 'rounded-xl' : 'rounded-full';
  }

  get textSizeClass(): string {
    return this.size === 'sm' ? 'text-xs' : 'text-sm';
  }
}
