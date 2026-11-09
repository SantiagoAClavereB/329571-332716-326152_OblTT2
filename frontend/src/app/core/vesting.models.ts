/** Tipos que devuelve VestingService. Los montos son bigint: para mostrarlos usar formatUnits(monto, token.decimals). */

/** Mismo orden que `enum Status` del contrato. */
export enum AgreementStatus {
  Active = 0,
  Completed = 1,
  Cancelled = 2,
}

export const STATUS_LABEL: Record<AgreementStatus, string> = {
  [AgreementStatus.Active]: 'Activo',
  [AgreementStatus.Completed]: 'Completado',
  [AgreementStatus.Cancelled]: 'Cancelado',
};

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

/** El struct `Agreement` del contrato. Las fechas son segundos Unix. */
export interface Agreement {
  id: bigint;
  payer: string;
  beneficiary: string;
  token: string;
  startTime: number;
  endTime: number;
  status: AgreementStatus;
  revocable: boolean;
  totalAmount: bigint;
  claimedAmount: bigint;
  vestedAtCancel: bigint;
}

/** Acuerdo + lo que calcula el contrato en este momento + datos del token. Es lo que muestran las pantallas. */
export interface AgreementDetails extends Agreement {
  vested: bigint; // vestedAmount(id)
  claimable: bigint; // claimableAmount(id): lo disponible para reclamar
  tokenInfo: TokenInfo;
}

export interface CreateAgreementParams {
  token: string;
  beneficiary: string;
  /** Monto ya convertido con parseUnits (usar VestingService.parseAmount). */
  amount: bigint;
  startTime: number; // segundos Unix
  endTime: number; // segundos Unix
  revocable: boolean;
}

export type HistoryEvent =
  | (HistoryBase & {
      type: 'AgreementCreated';
      payer: string;
      beneficiary: string;
      totalAmount: bigint;
    })
  | (HistoryBase & { type: 'Claimed'; beneficiary: string; amount: bigint })
  | (HistoryBase & {
      type: 'AgreementCancelled';
      payer: string;
      refundedToPayer: bigint;
      vestedAtCancel: bigint;
    });

interface HistoryBase {
  blockNumber: number;
  logIndex: number;
  txHash: string;
  timestamp: number; // segundos Unix del bloque
}
