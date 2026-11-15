import { TestBed } from '@angular/core/testing';
import type { ContractTransactionResponse } from 'ethers';
import { TransactionService } from './transaction.service';

/** Transacción falsa: `wait()` se resuelve o rechaza cuando el test quiere. */
function fakeTx(hash = '0xabc') {
  let resolve!: (r: any) => void;
  let reject!: (e: any) => void;
  const waited = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  const tx = { hash, wait: () => waited } as unknown as ContractTransactionResponse;
  return { tx, mine: (status = 1) => resolve({ status }), revert: (e: any) => reject(e) };
}

const tick = () => new Promise((r) => setTimeout(r));

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(() => {
    service = TestBed.inject(TransactionService);
  });

  it('pasa por firmando → pendiente → confirmada y avisa para recargar', async () => {
    const f = fakeTx();
    let sent!: (tx: ContractTransactionResponse) => void;
    const result = service.run('Reclamar', () => new Promise((res) => (sent = res)));

    expect(service.txs()[0]).toMatchObject({ label: 'Reclamar', status: 'signing' });
    expect(service.busy()).toBe(true);

    sent(f.tx);
    await tick();
    expect(service.txs()[0]).toMatchObject({ status: 'pending', hash: '0xabc' });

    f.mine();
    const receipt = await result;
    expect(receipt).toEqual({ status: 1 });
    expect(service.txs()[0].status).toBe('confirmed');
    expect(service.refreshTick()).toBe(1);
    expect(service.busy()).toBe(false);
  });

  it('si el usuario rechaza en MetaMask queda fallida con mensaje', async () => {
    const receipt = await service.run('Cancelar', () => Promise.reject({ code: 'ACTION_REJECTED' }));
    expect(receipt).toBeNull();
    expect(service.txs()[0]).toMatchObject({ status: 'failed', error: 'Rechazaste la transacción en MetaMask.' });
    expect(service.refreshTick()).toBe(0);
  });

  it('si la transacción revierte al minarse queda fallida', async () => {
    const f = fakeTx();
    const result = service.run('Crear', async () => f.tx);
    await tick();
    f.revert(new Error('boom'));
    expect(await result).toBeNull();
    expect(service.txs()[0]).toMatchObject({ status: 'failed', error: 'boom', hash: '0xabc' });
  });

  it('un recibo con status 0 cuenta como fallida', async () => {
    const f = fakeTx();
    const result = service.run('Crear', async () => f.tx);
    await tick();
    f.mine(0);
    expect(await result).toBeNull();
    expect(service.txs()[0].status).toBe('failed');
  });

  it('dismiss y clearFinished no sacan las que siguen en curso', async () => {
    await service.run('A', () => Promise.reject(new Error('x'))); // fallida
    const f = fakeTx();
    void service.run('B', async () => f.tx); // pendiente
    await tick();

    const [b, a] = service.txs();
    service.dismiss(b.id);
    expect(service.txs().length).toBe(2);
    service.dismiss(a.id);
    expect(service.txs().map((t) => t.label)).toEqual(['B']);

    f.mine();
    await tick();
    service.clearFinished();
    expect(service.txs()).toEqual([]);
  });
});
