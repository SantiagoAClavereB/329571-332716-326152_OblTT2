import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  canClaim,
  displayStatus,
  formatAmount,
  formatDate,
  percent,
  shortAddress,
  statusClass,
} from '../core/agreement-utils';
import { TransactionService } from '../core/transaction.service';
import { AgreementDetails, TokenInfo } from '../core/vesting.models';
import { VestingService } from '../core/vesting.service';
import { WalletService } from '../core/wallet.service';

/** Cada cuánto se recarga la lista para que el disponible avance en pantalla. */
const AUTO_REFRESH_MS = 5000;

/**
 * /ingresos: acuerdos donde la cuenta conectada es beneficiario.
 * Muestra total, devengado, reclamado y disponible, y permite reclamar.
 */
@Component({
  selector: 'app-ingresos',
  imports: [RouterLink],
  templateUrl: './ingresos.html',
  styleUrl: '../acuerdos/acuerdos.css',
})
export class Ingresos {
  protected readonly wallet = inject(WalletService);
  protected readonly tx = inject(TransactionService);
  private readonly vesting = inject(VestingService);

  protected readonly agreements = signal<AgreementDetails[] | null>(null);
  protected readonly now = signal<number | null>(null);
  protected readonly loadError = signal<string | null>(null);

  /** Disponible para reclamar sumado por token (puede haber acuerdos en tokens distintos). */
  protected readonly totalsByToken = computed(() => {
    const totals = new Map<string, { token: TokenInfo; amount: bigint }>();
    for (const a of this.agreements() ?? []) {
      if (a.claimable === 0n) continue;
      const t = totals.get(a.tokenInfo.address) ?? { token: a.tokenInfo, amount: 0n };
      t.amount += a.claimable;
      totals.set(a.tokenInfo.address, t);
    }
    return [...totals.values()];
  });

  protected readonly displayStatus = displayStatus;
  protected readonly statusClass = statusClass;
  protected readonly formatAmount = formatAmount;
  protected readonly formatDate = formatDate;
  protected readonly percent = percent;
  protected readonly shortAddress = shortAddress;

  private loadSeq = 0;

  constructor() {
    // Recargar al cambiar de cuenta o de red, y cuando se confirma una transacción.
    let lastKey = '';
    effect(() => {
      const key = `${this.wallet.account()}:${this.wallet.chainId()}`;
      this.tx.refreshTick();
      if (key !== lastKey) {
        lastKey = key;
        this.agreements.set(null);
        this.loadError.set(null);
      }
      void this.load();
    });

    const timer = setInterval(() => void this.load(), AUTO_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected canClaim(a: AgreementDetails): boolean {
    return canClaim(a, this.wallet.account());
  }

  protected async claim(a: AgreementDetails): Promise<void> {
    // El monto final lo calcula el contrato al minarse: puede ser un poco más que lo que se ve ahora.
    await this.tx.run(`Reclamar acuerdo #${a.id}`, () => this.vesting.claim(a.id));
  }

  protected async load(): Promise<void> {
    const account = this.wallet.account();
    if (!account || !this.wallet.isAnvil()) return;
    const seq = ++this.loadSeq;
    try {
      const [list, now] = await Promise.all([this.vesting.listAsBeneficiary(account), this.vesting.chainTime()]);
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
