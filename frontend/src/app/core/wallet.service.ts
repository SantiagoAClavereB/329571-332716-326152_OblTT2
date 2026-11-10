import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { BrowserProvider, JsonRpcSigner, getAddress } from 'ethers';
import type { InjectedProvider } from './ethereum';
import { ANVIL } from './networks';

/**
 * Conexión con la billetera (MetaMask).
 * Guarda cuenta y red en signals y escucha `accountsChanged` / `chainChanged`
 * para que la pantalla se actualice sola al cambiar de cuenta o de red.
 */
@Injectable({ providedIn: 'root' })
export class WalletService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly ethereum: InjectedProvider | undefined = window.ethereum;

  readonly account = signal<string | null>(null);
  readonly chainId = signal<bigint | null>(null);
  readonly error = signal<string | null>(null);

  readonly hasWallet = !!this.ethereum;
  readonly isConnected = computed(() => this.account() !== null);
  readonly isAnvil = computed(() => this.chainId() === ANVIL.chainId);

  private readonly onAccountsChanged = (accounts: string[]) =>
    this.zone.run(() => this.account.set(toChecksum(accounts[0])));

  private readonly onChainChanged = (chainIdHex: string) =>
    this.zone.run(() => this.chainId.set(BigInt(chainIdHex)));

  constructor() {
    if (!this.ethereum) return;
    this.ethereum.on('accountsChanged', this.onAccountsChanged);
    this.ethereum.on('chainChanged', this.onChainChanged);
    // Si el sitio ya estaba autorizado, recuperar la cuenta sin abrir el popup.
    void this.refresh('eth_accounts');
  }

  /** Pide permiso a MetaMask (abre el popup). */
  async connect(): Promise<void> {
    this.error.set(null);
    if (!this.ethereum) {
      this.error.set('No se detectó MetaMask. Instalá la extensión y recargá la página.');
      return;
    }
    await this.refresh('eth_requestAccounts');
  }

  /** Cambia MetaMask a Anvil y, si la red no existe, la agrega. */
  async switchToAnvil(): Promise<void> {
    if (!this.ethereum) return;
    this.error.set(null);
    try {
      await this.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ANVIL.chainIdHex }],
      });
    } catch (e: any) {
      if (e?.code !== 4902) {
        this.error.set(this.describe(e));
        return;
      }
      try {
        await this.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: ANVIL.chainIdHex,
              chainName: ANVIL.name,
              rpcUrls: [ANVIL.rpcUrl],
              nativeCurrency: ANVIL.currency,
            },
          ],
        });
      } catch (e2) {
        this.error.set(this.describe(e2));
      }
    }
  }

  /** Proveedor de Ethers sobre la billetera. Se crea en cada uso para no quedar atado a una red vieja. */
  provider(): BrowserProvider {
    if (!this.ethereum) throw new Error('No hay billetera');
    return new BrowserProvider(this.ethereum);
  }

  signer(): Promise<JsonRpcSigner> {
    return this.provider().getSigner();
  }

  ngOnDestroy(): void {
    this.ethereum?.removeListener('accountsChanged', this.onAccountsChanged);
    this.ethereum?.removeListener('chainChanged', this.onChainChanged);
  }

  private async refresh(method: 'eth_accounts' | 'eth_requestAccounts'): Promise<void> {
    try {
      const accounts = (await this.ethereum!.request({ method })) as string[];
      const chainIdHex = (await this.ethereum!.request({ method: 'eth_chainId' })) as string;
      this.account.set(toChecksum(accounts[0]));
      this.chainId.set(BigInt(chainIdHex));
    } catch (e) {
      this.error.set(this.describe(e));
    }
  }

  private describe(e: any): string {
    if (e?.code === 4001) return 'Rechazaste la solicitud en MetaMask.';
    if (e?.code === -32002) return 'Ya hay una solicitud pendiente: abrí MetaMask.';
    return e?.shortMessage ?? e?.message ?? String(e);
  }
}

/** MetaMask devuelve las direcciones en minúsculas: se guardan con checksum (formato estándar con mayúsculas). */
function toChecksum(address: string | undefined): string | null {
  return address ? getAddress(address) : null;
}
