import { Routes } from '@angular/router';
import { WalletCheck } from './wallet-check/wallet-check';

export const routes: Routes = [
  { path: '', component: WalletCheck },
  { path: '**', redirectTo: '' },
];
