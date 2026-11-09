import { Routes } from '@angular/router';
import { Acuerdos } from './acuerdos/acuerdos';
import { Crear } from './crear/crear';
import { WalletCheck } from './wallet-check/wallet-check';

export const routes: Routes = [
  { path: '', component: WalletCheck },
  { path: 'crear', component: Crear },
  { path: 'acuerdos', component: Acuerdos },
  { path: '**', redirectTo: '' },
];
