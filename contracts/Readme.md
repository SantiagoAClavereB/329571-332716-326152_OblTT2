# Contratos (Hardhat)

Estos son los smart contracts del proyecto, con sus tests y los scripts de deploy. Las instrucciones paso a paso para instalar, desplegar y usar la dApp están en el [README de la raíz](../README.md). Las decisiones de diseño están en [`docs/DECISIONES_DEFENSA.md`](../docs/DECISIONES_DEFENSA.md).

## Estructura

| Archivo | Qué es |
|---|---|
| `src/IVestingManager.sol` | Interfaz: struct `Agreement`, estados, eventos, custom errors y funciones |
| `src/VestingManager.sol` | Contrato de vesting: crear, reclamar, cancelar y lecturas |
| `src/VestingManagerUpgradeable.sol` | Variante UUPS que reutiliza `VestingManager` detrás de un proxy (desafío B) |
| `src/MockToken.sol`, `src/MockPermitToken.sol` | Tokens ERC-20 de prueba con decimales configurables y `mint` abierto; el segundo agrega EIP-2612 |
| `src/mocks/` | Contratos que solo usan los tests: `ReentrantToken` (intenta reentrar), `FeeToken` (cobra comisión), `VestingManagerUpgradeableV2` (para probar el upgrade) y `ProxyImports` (trae el proxy ERC-1967) |
| `test/VestingManager.test.js` | Tests unitarios, de entradas aleatorias y de reentrancy |
| `test/VestingInvariant.test.js` | Invariantes: secuencias aleatorias de crear, reclamar, cancelar y avanzar el tiempo, verificadas en cada paso |
| `test/VestingCliff.test.js`, `VestingBatch.test.js`, `VestingPermit.test.js`, `VestingUpgradeable.test.js` | Tests de los desafíos opcionales A, C, E y B |
| `test/helpers.js` | Funciones compartidas: manejo del tiempo (`at`, `warp`), generador con semilla y constantes |
| `script/deploy.js`, `script/deployUpgradeable.js` | Despliegan los contratos y escriben las direcciones en `../frontend/public/deployments.json` |
| `script/measureOps.js`, `script/compare-costs.mjs` | Miden el gas y el costo de las operaciones por red (desafío D) |
| `hardhat.config.js` | Compilador, rutas y redes |

OpenZeppelin viene de npm (`@openzeppelin/contracts`, versión fija en `package.json`). No hace falta ningún submódulo de Git para compilar ni para probar.

## Comandos

```bash
npm install                # instalar dependencias (una vez)
npm run compile            # compilar
npm test                   # correr los tests
npm run coverage           # tests + cobertura por archivo (HTML en coverage/index.html)
npm run node               # nodo local en 127.0.0.1:8545, un bloque por segundo
npm run deploy:local       # despliega en ese nodo y escribe deployments.json
```

## Deploy en el nodo local

Con `npm run node` corriendo en otra terminal:

```bash
npm run deploy:local
```

El script despliega, en este orden:

| Contrato | Dirección en un nodo recién iniciado |
|---|---|
| `MockToken` ("Test USD", `tUSD`, 6 decimales) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `MockPermitToken` ("Permit USD", `pUSD`, 6 decimales, con EIP-2612) | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `VestingManager` | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

La dirección de un contrato sale de la cuenta que despliega y de su nonce, así que depende de este orden: si se agrega o se mueve un deploy en el script, las direcciones cambian. Después le da 1.000.000 de cada token a la cuenta #0 y agrega las direcciones de esta red a `../frontend/public/deployments.json`, sin borrar las de otras redes.

## Configuración de los tests

- El compilador es Solidity 0.8.28 con optimizador (200 corridas) y EVM `cancun`.
- Los tests corren en la red en memoria de Hardhat, con `allowBlocksWithSameTimestamp` activado. Así un test puede mirar el estado en el segundo X y enviar una transacción exactamente en X, que es lo que hace falta para probar los límites («justo en `endTime`»).
- Los tests de entradas aleatorias y el de invariantes usan un generador con semilla fija: son reproducibles.
