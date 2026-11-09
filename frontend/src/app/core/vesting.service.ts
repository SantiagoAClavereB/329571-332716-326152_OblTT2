import { Injectable, inject } from '@angular/core';
import {
  Contract,
  ContractTransactionReceipt,
  ContractTransactionResponse,
  EventLog,
  Interface,
  Provider,
  Signer,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
} from 'ethers';
import { ERC20_ABI, VESTING_ABI } from './abis';
import {
  Agreement,
  AgreementDetails,
  AgreementStatus,
  CreateAgreementParams,
  HistoryEvent,
  TokenInfo,
} from './vesting.models';
import { WalletService } from './wallet.service';

/** Archivo que genera el script de deploy (A) en `frontend/public/`. */
export const DEPLOYMENTS_URL = 'deployments.json';

/**
 * Formato de `public/deployments.json`, indexado por chainId:
 * `{ "31337": { "vestingManager": "0x…", "deployBlock": 0 } }`
 */
export type Deployments = Record<string, { vestingManager: string; deployBlock?: number }>;

const ERROR_MESSAGES: Record<string, string> = {
  ZeroAddress: 'Hay una dirección vacía (0x000…).',
  InvalidBeneficiary: 'El beneficiario no es válido (no puede ser 0x0 ni el propio contrato).',
  ZeroAmount: 'El monto tiene que ser mayor que 0.',
  InvalidTimeRange: 'Las fechas no son válidas: el fin tiene que ser posterior al inicio y estar en el futuro.',
  FeeOnTransferNotSupported: 'El token cobra comisión al transferir y no está soportado.',
  AgreementNotFound: 'El acuerdo no existe.',
  NotPayer: 'Solo el pagador puede hacer esto.',
  NotBeneficiary: 'Solo el beneficiario puede reclamar.',
  NotActive: 'El acuerdo no está activo.',
  NotRevocable: 'El acuerdo no es revocable.',
  AlreadyEnded: 'El período ya terminó: no se puede cancelar.',
  NothingToClaim: 'No hay nada disponible para reclamar.',
  ERC20InsufficientBalance: 'No tenés saldo suficiente del token.',
  ERC20InsufficientAllowance: 'Falta aprobar (approve) el monto del token.',
};

/**
 * Acceso al contrato de vesting con Ethers.js.
 * - Lecturas: acuerdos, devengado, disponible, listados por pagador/beneficiario y datos del token.
 * - Escrituras: approve, createAgreement, claim y cancel. Devuelven la transacción sin esperarla:
 *   el seguimiento (pendiente / confirmada / fallida) es trabajo de TransactionService.
 * - Historial: consulta los eventos del contrato para un acuerdo.
 * La dirección del contrato sale de `deployments.json` según la red conectada.
 */
@Injectable({ providedIn: 'root' })
export class VestingService {
  private readonly wallet = inject(WalletService);

  private deployments?: Promise<Deployments>;
  private readonly tokenCache = new Map<string, Promise<TokenInfo>>();
  private readonly verified = new Set<string>(); // direcciones de vesting con código ya comprobado

  // ------------------------------------------------------------------ Lecturas

  async getAgreement(id: bigint): Promise<Agreement> {
    const vesting = await this.vesting();
    return toAgreement(id, await vesting['getAgreement'](id));
  }

  /** Acuerdo + devengado + disponible + datos del token, en una sola llamada. */
  async getAgreementDetails(id: bigint): Promise<AgreementDetails> {
    const vesting = await this.vesting();
    const [raw, vested, claimable] = await Promise.all([
      vesting['getAgreement'](id),
      vesting['vestedAmount'](id) as Promise<bigint>,
      vesting['claimableAmount'](id) as Promise<bigint>,
    ]);
    const agreement = toAgreement(id, raw);
    return { ...agreement, vested, claimable, tokenInfo: await this.tokenInfo(agreement.token) };
  }

  /** Acuerdos donde `account` es pagador (pantalla /acuerdos), del más nuevo al más viejo. */
  async listAsPayer(account: string): Promise<AgreementDetails[]> {
    const vesting = await this.vesting();
    return this.detailsFor(await vesting['getAgreementsByPayer'](account));
  }

  /** Acuerdos donde `account` es beneficiario (pantalla /ingresos), del más nuevo al más viejo. */
  async listAsBeneficiary(account: string): Promise<AgreementDetails[]> {
    const vesting = await this.vesting();
    return this.detailsFor(await vesting['getAgreementsByBeneficiary'](account));
  }

  /** name/symbol/decimals del token. Se cachea por red + dirección. decimals() se lee, no se asume 18. */
  tokenInfo(address: string): Promise<TokenInfo> {
    const key = `${this.wallet.chainId()}:${address.toLowerCase()}`;
    let info = this.tokenCache.get(key);
    if (!info) {
      info = this.loadTokenInfo(address);
      info.catch(() => this.tokenCache.delete(key)); // si falla, reintentar la próxima vez
      this.tokenCache.set(key, info);
    }
    return info;
  }

  tokenBalance(token: string, account: string): Promise<bigint> {
    return this.erc20(token, this.wallet.provider())['balanceOf'](account);
  }

  async allowance(token: string, owner: string): Promise<bigint> {
    return this.erc20(token, this.wallet.provider())['allowance'](owner, await this.vestingAddress());
  }

  /** Hora de la cadena (timestamp del último bloque). Usar esto y no Date.now() para el progreso. */
  async chainTime(): Promise<number> {
    const block = await this.wallet.provider().getBlock('latest');
    return block!.timestamp;
  }

  /** Eventos del acuerdo (creación, reclamos, cancelación), en orden cronológico. */
  async history(id: bigint): Promise<HistoryEvent[]> {
    const vesting = await this.vesting();
    const fromBlock = (await this.deployment()).deployBlock ?? 0;
    const f = vesting.filters;
    const logs = (
      await Promise.all([
        vesting.queryFilter(f['AgreementCreated'](id), fromBlock),
        vesting.queryFilter(f['Claimed'](id), fromBlock),
        vesting.queryFilter(f['AgreementCancelled'](id), fromBlock),
      ])
    )
      .flat()
      .filter((l): l is EventLog => l instanceof EventLog)
      .sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

    const provider = this.wallet.provider();
    const blockTimes = new Map<number, number>();
    await Promise.all(
      [...new Set(logs.map((l) => l.blockNumber))].map(async (n) =>
        blockTimes.set(n, (await provider.getBlock(n))!.timestamp),
      ),
    );

    return logs.map((log): HistoryEvent => {
      const base = {
        blockNumber: log.blockNumber,
        logIndex: log.index,
        txHash: log.transactionHash,
        timestamp: blockTimes.get(log.blockNumber)!,
      };
      const a = log.args;
      switch (log.eventName) {
        case 'AgreementCreated':
          return { ...base, type: 'AgreementCreated', payer: a['payer'], beneficiary: a['beneficiary'], totalAmount: a['totalAmount'] };
        case 'Claimed':
          return { ...base, type: 'Claimed', beneficiary: a['beneficiary'], amount: a['amount'] };
        default:
          return {
            ...base,
            type: 'AgreementCancelled',
            payer: a['payer'],
            refundedToPayer: a['refundedToPayer'],
            vestedAtCancel: a['vestedAtCancel'],
          };
      }
    });
  }

  // --------------------------------------------------------------- Escrituras
  // Devuelven la transacción enviada; no esperan la confirmación (eso lo hace TransactionService).

  /** true si hay que hacer approve antes de crear el acuerdo. */
  async needsApproval(token: string, owner: string, amount: bigint): Promise<boolean> {
    return (await this.allowance(token, owner)) < amount;
  }

  /** Autoriza al contrato de vesting a mover `amount` del token. Primer paso de /crear. */
  async approve(token: string, amount: bigint): Promise<ContractTransactionResponse> {
    const erc20 = this.erc20(token, await this.wallet.signer());
    return erc20['approve'](await this.vestingAddress(), amount);
  }

  async createAgreement(p: CreateAgreementParams): Promise<ContractTransactionResponse> {
    const vesting = await this.vesting(await this.wallet.signer());
    return vesting['createAgreement'](p.token, p.beneficiary, p.amount, p.startTime, p.endTime, p.revocable);
  }

  async claim(id: bigint): Promise<ContractTransactionResponse> {
    const vesting = await this.vesting(await this.wallet.signer());
    return vesting['claim'](id);
  }

  async cancel(id: bigint): Promise<ContractTransactionResponse> {
    const vesting = await this.vesting(await this.wallet.signer());
    return vesting['cancel'](id);
  }

  /** Saca el id del evento AgreementCreated del recibo de createAgreement. */
  async agreementIdFromReceipt(receipt: ContractTransactionReceipt): Promise<bigint | null> {
    const vesting = await this.vesting();
    for (const log of receipt.logs) {
      const parsed = vesting.interface.parseLog(log);
      if (parsed?.name === 'AgreementCreated') return parsed.args['id'];
    }
    return null;
  }

  // ------------------------------------------------------------------ Helpers

  /** Texto del usuario → bigint con los decimales del token. Lanza error si el formato es inválido. */
  parseAmount(value: string, decimals: number): bigint {
    return parseUnits(value.trim(), decimals);
  }

  formatAmount(amount: bigint, decimals: number): string {
    return formatUnits(amount, decimals);
  }

  /** Mensaje en español para un error de MetaMask / Ethers / revert del contrato. */
  errorMessage(e: any): string {
    if (e?.code === 'ACTION_REJECTED' || e?.info?.error?.code === 4001) return 'Rechazaste la transacción en MetaMask.';
    const name: string | undefined = e?.revert?.name ?? decodeErrorName(e);
    if (name) return ERROR_MESSAGES[name] ?? `El contrato rechazó la operación (${name}).`;
    return e?.shortMessage ?? e?.message ?? String(e);
  }

  // ------------------------------------------------------------------ Privado

  private async vesting(runner: Provider | Signer = this.wallet.provider()): Promise<Contract> {
    return new Contract(await this.vestingAddress(), VESTING_ABI, runner);
  }

  private erc20(address: string, runner: Provider | Signer): Contract {
    if (!isAddress(address)) throw new Error('La dirección del token no es válida.');
    return new Contract(address, ERC20_ABI, runner);
  }

  /** Dirección del contrato en la red actual. Verifica que haya código (p. ej. si se reinició Anvil sin redeploy). */
  private async vestingAddress(): Promise<string> {
    const address = getAddress((await this.deployment()).vestingManager);
    const key = `${this.wallet.chainId()}:${address}`;
    if (!this.verified.has(key)) {
      if ((await this.wallet.provider().getCode(address)) === '0x') {
        this.deployments = undefined; // releer deployments.json la próxima vez (por si se redesplegó)
        throw new Error('No hay contrato de vesting en la dirección de deployments.json: volvé a correr el deploy.');
      }
      this.verified.add(key);
    }
    return address;
  }

  /** Datos del deploy para la red conectada. */
  private async deployment(): Promise<Deployments[string]> {
    const chainId = this.wallet.chainId();
    if (chainId === null) throw new Error('Conectá la billetera primero.');
    const entry = (await this.loadDeployments())[chainId.toString()];
    if (!entry) throw new Error(`El contrato no está desplegado en la red ${chainId}. Cambiá a Anvil.`);
    return entry;
  }

  private loadDeployments(): Promise<Deployments> {
    if (!this.deployments) {
      this.deployments = fetch(DEPLOYMENTS_URL, { cache: 'no-store' }).then(async (res) => {
        if (!res.ok) throw new Error(`No se encontró ${DEPLOYMENTS_URL}: hay que correr el script de deploy.`);
        return (await res.json()) as Deployments;
      });
      // Si falla (por ejemplo, todavía no se desplegó) no se cachea el error.
      this.deployments.catch(() => (this.deployments = undefined));
    }
    return this.deployments;
  }

  private async loadTokenInfo(address: string): Promise<TokenInfo> {
    const erc20 = this.erc20(address, this.wallet.provider());
    const [name, symbol, decimals] = await Promise.all([
      erc20['name']() as Promise<string>,
      erc20['symbol']() as Promise<string>,
      erc20['decimals']() as Promise<bigint>,
    ]);
    return { address: getAddress(address), name, symbol, decimals: Number(decimals) };
  }

  private async detailsFor(ids: bigint[]): Promise<AgreementDetails[]> {
    const details = await Promise.all(ids.map((id) => this.getAgreementDetails(id)));
    return details.sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
  }
}

/** Para decodificar custom errors que Ethers no decodifica solo (p. ej. reverts al estimar gas). */
const ERRORS_IFACE = new Interface([...VESTING_ABI, ...ERC20_ABI].filter((f) => f.startsWith('error ')));

/** Busca los datos del revert en el error (Ethers y MetaMask los anidan distinto) y devuelve el nombre del error. */
function decodeErrorName(e: any): string | undefined {
  const seen = new Set<any>();
  const stack = [e];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    for (const v of [cur.data, cur.data?.data]) {
      if (typeof v === 'string' && /^0x[0-9a-fA-F]{8}/.test(v)) {
        const parsed = ERRORS_IFACE.parseError(v);
        if (parsed) return parsed.name;
      }
    }
    stack.push(cur.info, cur.error, cur.data, cur.cause);
  }
  return undefined;
}

function toAgreement(id: bigint, r: any): Agreement {
  return {
    id,
    payer: r.payer,
    beneficiary: r.beneficiary,
    token: r.token,
    startTime: Number(r.startTime),
    endTime: Number(r.endTime),
    status: Number(r.status) as AgreementStatus,
    revocable: r.revocable,
    totalAmount: r.totalAmount,
    claimedAmount: r.claimedAmount,
    vestedAtCancel: r.vestedAtCancel,
  };
}
