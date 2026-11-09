import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import {
  canCancel,
  canClaim,
  cancelBlockedReason,
  cancelConfirmText,
  displayStatus,
  formatAmount,
  formatDate,
  percent,
  shortAddress,
  statusClass,
  timeProgress,
} from '../core/agreement-utils';
import { TransactionService } from '../core/transaction.service';
import { AgreementDetails, HistoryEvent } from '../core/vesting.models';
import { VestingService } from '../core/vesting.service';
import { WalletService } from '../core/wallet.service';

const AUTO_REFRESH_MS = 5000;

const EVENT_LABEL: Record<HistoryEvent['type'], string> = {
  AgreementCreated: 'Creado',
  Claimed: 'Reclamo',
  AgreementCancelled: 'Cancelado',
};

/** Convierte el parámetro de la ruta en id; null si no es un número entero positivo. */
function parseId(param: string | null): bigint | null {
  return param && /^\d+$/.test(param) && param !== '0' ? BigInt(param) : null;
}

/**
 * /acuerdos/:id: información completa del acuerdo, progreso temporal, estado
 * e historial de eventos. Muestra Cancelar al pagador y Reclamar al beneficiario.
 */
@Component({
  selector: 'app-detalle',
  imports: [RouterLink],
  templateUrl: './detalle.html',
  styleUrl: './detalle.css',
})
export class Detalle {
  protected readonly wallet = inject(WalletService);
  protected readonly tx = inject(TransactionService);
  private readonly vesting = inject(VestingService);

  protected readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => parseId(p.get('id')))), {
    initialValue: null,
  });

  protected readonly agreement = signal<AgreementDetails | null>(null);
  protected readonly history = signal<HistoryEvent[] | null>(null);
  protected readonly now = signal<number | null>(null);
  protected readonly loadError = signal<string | null>(null);

  /** Rol de la cuenta conectada en este acuerdo. */
  protected readonly role = computed(() => {
    const a = this.agreement();
    const account = this.wallet.account()?.toLowerCase();
    if (!a || !account) return null;
    if (a.payer.toLowerCase() === account) return 'Pagador';
    if (a.beneficiary.toLowerCase() === account) return 'Beneficiario';
    return 'Sin permisos (solo lectura)';
  });

  protected readonly cancelEvent = computed(
    () => this.history()?.find((e) => e.type === 'AgreementCancelled') as
      | Extract<HistoryEvent, { type: 'AgreementCancelled' }>
      | undefined,
  );

  protected readonly displayStatus = displayStatus;
  protected readonly statusClass = statusClass;
  protected readonly cancelBlockedReason = cancelBlockedReason;
  protected readonly formatAmount = formatAmount;
  protected readonly formatDate = formatDate;
  protected readonly percent = percent;
  protected readonly shortAddress = shortAddress;
  protected readonly timeProgress = timeProgress;
  protected readonly eventLabel = EVENT_LABEL;

  private loadSeq = 0;

  constructor() {
    // Recargar al cambiar de acuerdo, cuenta o red, y cuando se confirma una transacción.
    let lastKey = '';
    effect(() => {
      const key = `${this.id()}:${this.wallet.account()}:${this.wallet.chainId()}`;
      this.tx.refreshTick();
      if (key !== lastKey) {
        lastKey = key;
        this.agreement.set(null);
        this.history.set(null);
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

  protected canClaim(a: AgreementDetails): boolean {
    return canClaim(a, this.wallet.account());
  }

  protected async cancel(a: AgreementDetails): Promise<void> {
    if (!confirm(cancelConfirmText(a))) return;
    await this.tx.run(`Cancelar acuerdo #${a.id}`, () => this.vesting.cancel(a.id));
  }

  protected async claim(a: AgreementDetails): Promise<void> {
    await this.tx.run(`Reclamar acuerdo #${a.id}`, () => this.vesting.claim(a.id));
  }

  /** Monto de un evento del historial, formateado con el token del acuerdo. */
  protected eventAmount(e: HistoryEvent, a: AgreementDetails): string {
    switch (e.type) {
      case 'AgreementCreated':
        return formatAmount(e.totalAmount, a.tokenInfo);
      case 'Claimed':
        return formatAmount(e.amount, a.tokenInfo);
      case 'AgreementCancelled':
        return `${formatAmount(e.refundedToPayer, a.tokenInfo)} devueltos al pagador`;
    }
  }

  private async load(): Promise<void> {
    const id = this.id();
    if (id === null || !this.wallet.account() || !this.wallet.isAnvil()) return;
    const seq = ++this.loadSeq;
    try {
      const [agreement, history, now] = await Promise.all([
        this.vesting.getAgreementDetails(id),
        this.vesting.history(id),
        this.vesting.chainTime(),
      ]);
      if (seq !== this.loadSeq) return;
      this.agreement.set(agreement);
      this.history.set(history);
      this.now.set(now);
      this.loadError.set(null);
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.agreement.set(null);
      this.loadError.set(this.vesting.errorMessage(e));
    }
  }
}
