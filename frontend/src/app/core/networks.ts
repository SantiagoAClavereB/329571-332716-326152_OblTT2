/** Red local de Anvil (chainId por defecto de `anvil`). */
export const ANVIL = {
  chainId: 31337n,
  chainIdHex: '0x7a69',
  name: 'Anvil (local)',
  rpcUrl: 'http://127.0.0.1:8545',
  currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
} as const;
