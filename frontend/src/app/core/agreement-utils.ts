import { formatUnits } from 'ethers';
import { Agreement, AgreementStatus, STATUS_LABEL, TokenInfo } from './vesting.models';

/**
 * Funciones comunes de las pantallas de acuerdos.
 * `now` es siempre la hora de la cadena (VestingService.chainTime), no la de la PC.
 */

/**
 * Estado para mostrar. El contrato solo tiene Active / Completed / Cancelled;
 * acá se distingue un acuerdo activo que todavía no empezó o cuyo período ya terminó.
 */
export function displayStatus(a: Agreement, now: number | null): string {
  if (a.status !== AgreementStatus.Active || now === null) return STATUS_LABEL[a.status];
  if (now < a.startTime) return 'Por empezar';
  if (now >= a.endTime) return 'Período terminado';
  return STATUS_LABEL[a.status];
}

/** Clase CSS según el estado (para colorear). */
export function statusClass(a: Agreement, now: number | null): string {
  if (a.status === AgreementStatus.Cancelled) return 'cancelled';
  if (a.status === AgreementStatus.Completed) return 'completed';
  if (now !== null && now >= a.endTime) return 'ended';
  return 'active';
}

/** El pagador puede cancelar: acuerdo activo, revocable y antes del fin (si no, el contrato revierte). */
export function canCancel(a: Agreement, now: number | null, account: string | null): boolean {
  return (
    !!account &&
    a.payer.toLowerCase() === account.toLowerCase() &&
    a.status === AgreementStatus.Active &&
    a.revocable &&
    now !== null &&
    now < a.endTime
  );
}

/** Por qué no se puede cancelar (para el tooltip del botón). */
export function cancelBlockedReason(a: Agreement, now: number | null): string | null {
  if (a.status === AgreementStatus.Cancelled) return 'Ya está cancelado.';
  if (a.status === AgreementStatus.Completed) return 'Ya está completado.';
  if (!a.revocable) return 'No es revocable.';
  if (now !== null && now >= a.endTime) return 'El período ya terminó.';
  return null;
}

/** Porcentaje (0–100) de `part` sobre `total`, con un decimal. */
export function percent(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((part * 1000n) / total) / 10;
}

/** Monto bigint → texto con el símbolo del token, usando sus decimales. */
export function formatAmount(amount: bigint, token: TokenInfo): string {
  return `${formatUnits(amount, token.decimals)} ${token.symbol}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Segundos Unix → fecha y hora local. */
export function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' });
}

/** El beneficiario puede reclamar si hay saldo disponible (también después de una cancelación). */
export function canClaim(a: Agreement & { claimable: bigint }, account: string | null): boolean {
  return !!account && a.beneficiary.toLowerCase() === account.toLowerCase() && a.claimable > 0n;
}

/** Progreso temporal (0–100): cuánto del período ya pasó. */
export function timeProgress(a: Agreement, now: number | null): number {
  if (now === null || now <= a.startTime) return 0;
  if (now >= a.endTime) return 100;
  return Math.floor(((now - a.startTime) * 1000) / (a.endTime - a.startTime)) / 10;
}

/** Texto del confirm antes de cancelar. */
export function cancelConfirmText(a: Agreement & { vested: bigint; tokenInfo: TokenInfo }): string {
  const refund = formatAmount(a.totalAmount - a.vested, a.tokenInfo);
  return (
    `¿Cancelar el acuerdo #${a.id}?\n\n` +
    `Se te devuelve aproximadamente ${refund} (lo no devengado). ` +
    `Lo devengado hasta ahora queda para el beneficiario, que lo puede reclamar después.`
  );
}
