import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Restore theme preference immediately before bootstrap to prevent Light Mode flash
try {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
