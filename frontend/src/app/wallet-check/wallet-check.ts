import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Contract, formatEther, formatUnits, isAddress } from 'ethers';
import { WalletService } from '../core/wallet.service';
import { ANVIL } from '../core/networks';
import { ERC20_ABI } from '../core/abis';

const TOKEN_KEY = 'walletCheck.token';

interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  balance: string; // ya formateado con formatUnits (los bigint no se pueden mostrar/serializar tal cual)
}

/**
 * Prueba mínima de la Fase 1: conectar MetaMask, mostrar cuenta y red,
 * y leer el balance de un token ERC-20 desplegado en la red local.
 */
@Component({
  selector: 'app-wallet-check',
  imports: [FormsModule],
  templateUrl: './wallet-check.html',
  styleUrl: './wallet-check.css',
})
export class WalletCheck {
  protected readonly wallet = inject(WalletService);
  protected readonly anvil = ANVIL;

  protected tokenAddress = this.loadToken();
  protected readonly ethBalance = signal<string | null>(null);
  protected readonly token = signal<TokenInfo | null>(null);
  protected readonly tokenError = signal<string | null>(null);
  protected readonly loading = signal(false);

  constructor() {
    // Al cambiar de cuenta o de red se recargan los datos.
    effect(() => {
      const account = this.wallet.account();
      this.wallet.chainId();
      this.token.set(null);
      this.tokenError.set(null);
      this.ethBalance.set(null);
      if (!account) return;
      void this.loadEthBalance(account);
      if (isAddress(this.tokenAddress)) void this.readToken();
    });
  }

  protected async readToken(): Promise<void> {
    const account = this.wallet.account();
    this.token.set(null);
    this.tokenError.set(null);
    if (!account) return;

    const address = this.tokenAddress.trim();
    if (!isAddress(address)) {
      this.tokenError.set('La dirección del token no es válida.');
      return;
    }
    this.saveToken(address);

    this.loading.set(true);
    try {
      const provider = this.wallet.provider();
      if ((await provider.getCode(address)) === '0x') {
        this.tokenError.set('No hay ningún contrato en esa dirección en la red actual.');
        return;
      }
      const erc20 = new Contract(address, ERC20_ABI, provider);
      const [name, symbol, decimals, raw] = await Promise.all([
        erc20['name']() as Promise<string>,
        erc20['symbol']() as Promise<string>,
        erc20['decimals']() as Promise<bigint>,
        erc20['balanceOf'](account) as Promise<bigint>,
      ]);
      // decimals() se lee del contrato: no se asume 18.
      this.token.set({ name, symbol, decimals: Number(decimals), balance: formatUnits(raw, decimals) });
    } catch (e: any) {
      this.tokenError.set(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEthBalance(account: string): Promise<void> {
    try {
      const wei = await this.wallet.provider().getBalance(account);
      this.ethBalance.set(formatEther(wei));
    } catch {
      this.ethBalance.set(null);
    }
  }

  private loadToken(): string {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private saveToken(address: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, address);
    } catch {
      /* sin storage: no pasa nada */
    }
  }
}
