/** Red local de Hardhat (`npm run node` en contracts/, chainId 31337). */
export const ANVIL = {
  chainId: 31337n,
  chainIdHex: '0x7a69',
  name: 'Hardhat (local)',
  rpcUrl: 'http://127.0.0.1:8545',
  currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
} as const;
