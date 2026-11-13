require("@nomicfoundation/hardhat-toolbox");

// Las URL de las redes de prueba salen de variables de entorno: no hay claves ni direcciones en el repo.
// Ver docs/DEPLOY_L2.md.
const { SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL, ARBITRUM_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  // Los contratos viven en src/ (no en contracts/, que es la carpeta del proyecto).
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    // Permite fijar con setNextBlockTimestamp el mismo segundo que el bloque anterior: asi un test puede mirar el
    // estado en el instante X y despues enviar una transaccion exactamente en X (los limites "justo en endTime").
    // Con `npm run node` (nodo local para la dApp) se mina un bloque por segundo, como hacia `anvil --block-time 1`:
    // sin eso el reloj de la cadena no avanza entre transacciones y el devengado "se queda quieto" en la demo.
    // Los tests no usan este modo: necesitan el reloj bajo su control.
    hardhat: {
      allowBlocksWithSameTimestamp: true,
      ...(process.argv.includes("node") && { mining: { auto: true, interval: 1000 } }),
    },
    localhost: { url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545" },
    ...(SEPOLIA_RPC_URL && { sepolia: { url: SEPOLIA_RPC_URL, accounts } }),
    ...(BASE_SEPOLIA_RPC_URL && { baseSepolia: { url: BASE_SEPOLIA_RPC_URL, accounts } }),
    ...(ARBITRUM_SEPOLIA_RPC_URL && { arbitrumSepolia: { url: ARBITRUM_SEPOLIA_RPC_URL, accounts } }),
  },
};
