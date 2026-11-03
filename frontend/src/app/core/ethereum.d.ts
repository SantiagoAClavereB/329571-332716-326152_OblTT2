import type { Eip1193Provider } from 'ethers';

/** Proveedor inyectado por MetaMask: EIP-1193 más los eventos on/removeListener. */
export interface InjectedProvider extends Eip1193Provider {
  isMetaMask?: boolean;
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}
