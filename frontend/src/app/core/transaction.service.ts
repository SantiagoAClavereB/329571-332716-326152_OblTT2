import { Injectable, computed, inject, signal } from '@angular/core';
import type { ContractTransactionReceipt, ContractTransactionResponse } from 'ethers';
import { VestingService } from './vesting.service';

/**
 * - signing: esperando que el usuario firme en MetaMask.
 * - pending: enviada, esperando que se mine.
 * - confirmed: minada con éxito.
 * - failed: rechazada en MetaMask, revertida por el contrato o error de red.
 */
export type TxStatus = 'signing' | 'pending' | 'confirmed' | 'failed';

export interface TrackedTx {
  id: number; // id local, para la lista de la pantalla
  label: string; // texto para el usuario, ej. "Reclamar acuerdo #3"
  status: TxStatus;
  hash?: string;
  error?: string;
  receipt?: ContractTransactionReceipt;
}

/**
 * Lleva el estado de cada transacción (firmando → pendiente → confirmada / fallida)
 * y avisa a las pantallas para que recarguen los datos cuando una se confirma.
 *
 * Uso típico en un componente:
 *   const receipt = await this.tx.run('Reclamar acuerdo #3', () => this.vesting.claim(id));
 *   if (receipt) { ... }   // null si falló (el error queda en la lista)
 *
 * Y para recargar al confirmar:
 *   effect(() => { this.tx.refreshTick(); void this.load(); });
 */
@Injectable({ providedIn: 'root' })
export class TransactionService {
  private readonly vesting = inject(VestingService);
  private nextId = 1;

  private readonly _txs = signal<TrackedTx[]>([]);
  /** Todas las transacciones de la sesión, la más nueva primero. */
  readonly txs = this._txs.asReadonly();

  /** Hay alguna transacción firmándose o sin minar (para deshabilitar botones). */
  readonly busy = computed(() => this._txs().some((t) => t.status === 'signing' || t.status === 'pending'));

  private readonly _refreshTick = signal(0);
  /** Se incrementa cada vez que se confirma una transacción: las pantallas lo leen en un effect para recargar. */
  readonly refreshTick = this._refreshTick.asReadonly();

  /**
   * Envía la transacción y sigue su estado hasta que se confirma o falla.
   * Devuelve el recibo si se confirmó, o null si falló (nunca lanza error).
   */
  async run(label: string, send: () => Promise<ContractTransactionResponse>): Promise<ContractTransactionReceipt | null> {
    const id = this.nextId++;
    this._txs.update((list) => [{ id, label, status: 'signing' }, ...list]);

    try {
      const tx = await send(); // acá se abre MetaMask
      this.patch(id, { status: 'pending', hash: tx.hash });

      const receipt = await tx.wait(); // lanza si la transacción revierte
      if (!receipt || receipt.status !== 1) throw new Error('La transacción falló.');

      this.patch(id, { status: 'confirmed', receipt });
      this._refreshTick.update((n) => n + 1);
      return receipt;
    } catch (e) {
      this.patch(id, { status: 'failed', error: this.vesting.errorMessage(e) });
      return null;
    }
  }

  /** Saca una transacción terminada de la lista (por ejemplo, al cerrar el aviso). */
  dismiss(id: number): void {
    this._txs.update((list) => list.filter((t) => t.id !== id || t.status === 'signing' || t.status === 'pending'));
  }

  /** Borra de la lista las confirmadas y fallidas. */
  clearFinished(): void {
    this._txs.update((list) => list.filter((t) => t.status === 'signing' || t.status === 'pending'));
  }

  private patch(id: number, changes: Partial<TrackedTx>): void {
    this._txs.update((list) => list.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  }
}
