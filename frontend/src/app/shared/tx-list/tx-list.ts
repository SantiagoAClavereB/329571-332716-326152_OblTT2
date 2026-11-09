import { Component, inject } from '@angular/core';
import { TransactionService, TxStatus } from '../../core/transaction.service';

const STATUS_TEXT: Record<TxStatus, string> = {
  signing: 'Confirmá en MetaMask…',
  pending: 'Pendiente…',
  confirmed: 'Confirmada',
  failed: 'Fallida',
};

/** Avisos con el estado de las transacciones (los lleva TransactionService). */
@Component({
  selector: 'app-tx-list',
  template: `
    @if (tx.txs().length) {
      <ul>
        @for (t of tx.txs(); track t.id) {
          <li [class]="t.status">
            <strong>{{ t.label }}</strong>
            <span>{{ statusText[t.status] }}</span>
            @if (t.error) {
              <span class="msg">{{ t.error }}</span>
            }
            @if (t.hash) {
              <span class="hash" [title]="t.hash">{{ t.hash.slice(0, 10) }}…</span>
            }
            @if (t.status === 'confirmed' || t.status === 'failed') {
              <button (click)="tx.dismiss(t.id)" aria-label="Cerrar">×</button>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    ul { list-style: none; margin: 0.5rem 1rem; padding: 0; display: grid; gap: 0.4rem; font-family: system-ui, sans-serif; }
    li { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; align-items: center; padding: 0.5rem 0.75rem; border-radius: 6px; border: 1px solid; }
    .signing, .pending { border-color: #b35900; background: #fff6ec; }
    .confirmed { border-color: #1a7f37; background: #eefaf1; }
    .failed { border-color: #c62828; background: #fdeeee; }
    .msg { color: #c62828; }
    .hash { font-family: ui-monospace, Consolas, monospace; color: #666; }
    button { margin-left: auto; border: none; background: none; font-size: 1.1rem; cursor: pointer; }
  `,
})
export class TxList {
  protected readonly tx = inject(TransactionService);
  protected readonly statusText = STATUS_TEXT;
}
