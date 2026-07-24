import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs/operators';
import { combineLatest, Observable } from 'rxjs';
import { Auth } from './auth';
import { CryptoService } from '../services/crypto.service';

export const authGuard: CanActivateFn = (route, state): Observable<boolean | UrlTree> => {
  const authService = inject(Auth);
  const cryptoService = inject(CryptoService);
  const router = inject(Router);

  return combineLatest([
    toObservable(authService.currentUser),
    toObservable(cryptoService.isKeyLoading)
  ]).pipe(
    filter(([user, isKeyLoading]) => user !== undefined && (!user || !user.username || !isKeyLoading)),
    take(1),
    map(([user]) => {
      const url = state.url;

      if (!user) {
        // User is not logged in
        if (url === '/login') {
          return true;
        }
        return router.createUrlTree(['/login']);
      }

      // User is logged in but has not claimed a username
      if (!user.username) {
        if (url === '/choose-username') {
          return true;
        }
        return router.createUrlTree(['/choose-username']);
      }

      // User is logged in and has a username
      if (!cryptoService.isPrivateKeyReady()) {
        if (url === '/login') {
          return true;
        }
        return router.createUrlTree(['/login']);
      }

      if (url === '/login' || url === '/choose-username') {
        return router.createUrlTree(['/chats']);
      }

      return true;
    })
  );
};

