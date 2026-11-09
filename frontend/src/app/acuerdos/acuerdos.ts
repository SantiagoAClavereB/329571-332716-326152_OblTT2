import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  canCancel,
  cancelBlockedReason,
  displayStatus,
  formatAmount,
  formatDate,
  percent,
  shortAddress,
  statusClass,
} from '../core/agreement-utils';
import { TransactionService } from '../core/transaction.service';
import { AgreementDetails } from '../core/vesting.models';
import { VestingService } from '../core/vesting.service';
import { WalletService } from '../core/wallet.service';

/** Cada cuánto se recarga la lista para que el devengado avance en pantalla. */
const AUTO_REFRESH_MS = 5000;

/**
 * /acuerdos: acuerdos donde la cuenta conectada es pagador.
 * Muestra estado, total y devengado, y permite cancelar cuando corresponde.
 */
@Component({
  selector: 'app-acuerdos',
  imports: [RouterLink],
  templateUrl: './acuerdos.html',
  styleUrl: './acuerdos.css',
})
export class Acuerdos {
  protected readonly wallet = inject(WalletService);
  protected readonly tx = inject(TransactionService);
  private readonly vesting = inject(VestingService);

  protected readonly agreements = signal<AgreementDetails[] | null>(null);
  protected readonly now = signal<number | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly displayStatus = displayStatus;
  protected readonly statusClass = statusClass;
  protected readonly cancelBlockedReason = cancelBlockedReason;
  protected readonly formatAmount = formatAmount;
  protected readonly formatDate = formatDate;
  protected readonly percent = percent;
  protected readonly shortAddress = shortAddress;

  /** Para descartar respuestas viejas si se superponen dos cargas. */
  private loadSeq = 0;

  constructor() {
    // Recargar al cambiar de cuenta o de red, y cuando se confirma una transacción.
    let lastKey = '';
    effect(() => {
      const key = `${this.wallet.account()}:${this.wallet.chainId()}`;
      this.tx.refreshTick();
      if (key !== lastKey) {
        // otra cuenta u otra red: no mostrar la lista anterior mientras carga
        lastKey = key;
        this.agreements.set(null);
        this.loadError.set(null);
      }
      void this.load();
    });

    const timer = setInterval(() => void this.load(), AUTO_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected canCancel(a: AgreementDetails): boolean {
    return canCancel(a, this.now(), this.wallet.account());
  }

  protected async cancel(a: AgreementDetails): Promise<void> {
    const refund = formatAmount(a.totalAmount - a.vested, a.tokenInfo);
    const ok = confirm(
      `¿Cancelar el acuerdo #${a.id}?\n\n` +
        `Se te devuelve aproximadamente ${refund} (lo no devengado). ` +
        `Lo devengado hasta ahora queda para el beneficiario, que lo puede reclamar después.`,
    );
    if (!ok) return;
    await this.tx.run(`Cancelar acuerdo #${a.id}`, () => this.vesting.cancel(a.id));
  }

  protected async load(): Promise<void> {
    const account = this.wallet.account();
    if (!account || !this.wallet.isAnvil()) return;
    const seq = ++this.loadSeq;
    try {
      const [list, now] = await Promise.all([this.vesting.listAsPayer(account), this.vesting.chainTime()]);
      if (seq !== this.loadSeq) return;
      this.agreements.set(list);
      this.now.set(now);
      this.loadError.set(null);
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.loadError.set(this.vesting.errorMessage(e));
    }
  }
}
