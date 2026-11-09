import { Routes } from '@angular/router';
import { Crear } from './crear/crear';
import { WalletCheck } from './wallet-check/wallet-check';

export const routes: Routes = [
  { path: '', component: WalletCheck },
  { path: 'crear', component: Crear },
  { path: '**', redirectTo: '' },
];
