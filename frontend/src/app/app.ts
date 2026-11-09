import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { WalletService } from './core/wallet.service';
import { TxList } from './shared/tx-list/tx-list';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TxList],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly wallet = inject(WalletService);

  protected readonly shortAccount = computed(() => {
    const a = this.wallet.account();
    return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
  });
}
