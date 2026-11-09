import { canCancel, canClaim, cancelBlockedReason, displayStatus, percent } from './agreement-utils';
import { Agreement, AgreementStatus } from './vesting.models';

const PAYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function agreement(changes: Partial<Agreement> = {}): Agreement {
  return {
    id: 1n,
    payer: PAYER,
    beneficiary: OTHER,
    token: OTHER,
    startTime: 100,
    endTime: 200,
    status: AgreementStatus.Active,
    revocable: true,
    totalAmount: 1000n,
    claimedAmount: 0n,
    vestedAtCancel: 0n,
    ...changes,
  };
}

describe('agreement-utils', () => {
  it('displayStatus distingue por empezar, activo y período terminado', () => {
    expect(displayStatus(agreement(), 50)).toBe('Por empezar');
    expect(displayStatus(agreement(), 150)).toBe('Activo');
    expect(displayStatus(agreement(), 200)).toBe('Período terminado');
    expect(displayStatus(agreement({ status: AgreementStatus.Cancelled }), 150)).toBe('Cancelado');
    expect(displayStatus(agreement({ status: AgreementStatus.Completed }), 250)).toBe('Completado');
  });

  it('canCancel: solo el pagador, activo, revocable y antes del fin', () => {
    expect(canCancel(agreement(), 150, PAYER)).toBe(true);
    expect(canCancel(agreement(), 150, PAYER.toLowerCase())).toBe(true);
    expect(canCancel(agreement(), 150, OTHER)).toBe(false);
    expect(canCancel(agreement(), 200, PAYER)).toBe(false); // en endTime el contrato revierte
    expect(canCancel(agreement({ revocable: false }), 150, PAYER)).toBe(false);
    expect(canCancel(agreement({ status: AgreementStatus.Cancelled }), 150, PAYER)).toBe(false);
    expect(canCancel(agreement(), null, PAYER)).toBe(false);
  });

  it('cancelBlockedReason explica por qué no se puede cancelar', () => {
    expect(cancelBlockedReason(agreement(), 150)).toBeNull();
    expect(cancelBlockedReason(agreement({ revocable: false }), 150)).toBe('No es revocable.');
    expect(cancelBlockedReason(agreement(), 250)).toBe('El período ya terminó.');
  });

  it('percent redondea hacia abajo a un decimal y tolera total 0', () => {
    expect(percent(1n, 3n)).toBe(33.3);
    expect(percent(1000n, 1000n)).toBe(100);
    expect(percent(0n, 0n)).toBe(0);
  });
});

describe('canClaim', () => {
  it('solo el beneficiario y con saldo disponible', () => {
    const a = {
      id: 1n, payer: PAYER, beneficiary: OTHER, token: OTHER, startTime: 100, endTime: 200,
      status: AgreementStatus.Cancelled, revocable: true, totalAmount: 1000n, claimedAmount: 0n, vestedAtCancel: 400n,
    };
    expect(canClaim({ ...a, claimable: 400n }, OTHER)).toBe(true); // tras cancelar sigue pudiendo reclamar
    expect(canClaim({ ...a, claimable: 400n }, OTHER.toLowerCase())).toBe(true);
    expect(canClaim({ ...a, claimable: 400n }, PAYER)).toBe(false);
    expect(canClaim({ ...a, claimable: 0n }, OTHER)).toBe(false);
  });
});
