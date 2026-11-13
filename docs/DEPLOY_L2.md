# Deploy en L2 y comparación de costos (desafío opcional D)

> **Estado: preparado, pero NO ejecutado en una testnet.** Desplegar en una L2 real exige una cuenta con fondos de
> prueba y un RPC con clave, y esos datos no están en el repo. Los scripts se probaron contra un nodo local de
> Hardhat; falta correrlos en Sepolia y en una L2 (por ejemplo Base Sepolia) y completar la tabla de resultados.

## Qué quedó listo

| Pieza | Para qué sirve |
|---|---|
| `networks` en `contracts/hardhat.config.js` | Redes `sepolia`, `baseSepolia` y `arbitrumSepolia`. Las URL y la clave salen de variables de entorno: no hay claves ni URL privadas en el repo. Una red solo se define si su variable existe. |
| `script/deploy.js` | El mismo script de deploy de siempre sirve para cualquier red. |
| `script/measureOps.js` | Ejecuta las operaciones relevantes sobre un contrato ya desplegado: `mint`, `approve`, `createAgreement`, `claim`, `createAgreement` y `cancel`. Guarda el gas, el precio efectivo y el `l1Fee` de cada una en `measurements/<chainId>.json`. |
| `script/compare-costs.mjs` | Lee esos archivos y muestra el gas y el costo en ETH de cada transacción. |

## Paso a paso

Todo se corre en una terminal, dentro de la carpeta `contracts/`, después de `npm install`.

### 1. Preparar una cuenta de pruebas (una sola vez)

Usá una cuenta **solo de pruebas**, nunca una con fondos reales. La clave privada va en una variable de entorno de tu
sesión: no la escribas en archivos del repo ni la subas a Git. Esa cuenta necesita ETH de prueba en cada red (se pide
en el *faucet* de la red).

```bash
export DEPLOYER_PRIVATE_KEY="0x..."
```

### 2. Configurar las URL de las redes

Necesitás un proveedor de RPC (por ejemplo Alchemy o Infura, con cuenta gratuita). La URL incluye tu clave, así que
va en variables de entorno de tu sesión y **no** se sube al repo:

```bash
export SEPOLIA_RPC_URL="https://..."
export BASE_SEPOLIA_RPC_URL="https://..."
```

### 3. Desplegar en cada red

```bash
npx hardhat run script/deploy.js --network sepolia
npx hardhat run script/deploy.js --network baseSepolia
```

`deploy.js` guarda las direcciones de cada red en `frontend/public/deployments.json`, indexadas por `chainId`
(Sepolia = `11155111`, Base Sepolia = `84532`). Solo escribe el archivo después de que las transacciones se minaron,
así que no deja direcciones de contratos que no existen.

### 4. Medir las operaciones

Tomá las direcciones de `deployments.json` (`vestingManager` y `mockToken` de cada red):

```bash
VESTING=0x... TOKEN=0x... npx hardhat run script/measureOps.js --network sepolia
VESTING=0x... TOKEN=0x... npx hardhat run script/measureOps.js --network baseSepolia
```

Cada corrida deja su resultado en `measurements/<chainId>.json`.

### 5. Ver los costos

```bash
npm run compare-costs -- measurements/11155111.json measurements/84532.json
```

## Resultados medidos en local

El **gas usado** depende solo del código del contrato y es la parte comparable entre redes compatibles con la EVM.
Estos valores salieron de `measureOps.js` contra un nodo local de Hardhat (Solidity 0.8.28, optimizador con 200
corridas):

| Operación | Gas usado (local) |
|---|---|
| `mint` (token de prueba) | 34.179 |
| `approve` | 46.330 |
| `createAgreement` (el primero, con storage nuevo) | 257.774 |
| `claim` | 76.131 |
| `createAgreement` (el segundo) | 201.674 |
| `cancel` | 79.221 |

El segundo `createAgreement` sale más barato que el primero porque algunos slots de storage ya no están en cero.

Qué **no** se comprobó, porque un nodo local no lo reproduce:

- El campo `l1Fee` de las L2 tipo OP Stack: en local siempre vale cero. `measureOps.js` lee el recibo crudo
  (`eth_getTransactionReceipt`) justamente para capturarlo cuando la red lo informe, pero no se vio con una L2 real.
- El comportamiento de Arbitrum y de las URL de proveedores reales.
- La firma con una cuenta real en una testnet: solo se usaron las cuentas públicas del nodo local.

## Resultados en redes reales (completar)

Nada de esta tabla se ejecutó todavía. Hay que llenarla con la salida de `compare-costs.mjs`:

| Operación | Sepolia: gas / gwei / costo (ETH) | L2 elegida: gas / gwei / `l1Fee` / costo (ETH) |
|---|---|---|
| `createAgreement` | _pendiente_ | _pendiente_ |
| `claim` | _pendiente_ | _pendiente_ |
| `cancel` | _pendiente_ | _pendiente_ |

## Cómo leer la comparación

- En una L2 el costo de una transacción tiene dos partes: la **ejecución en la L2** (gas usado × precio del gas de
  la L2, normalmente muy bajo) y la **publicación de los datos en L1**. En las redes tipo OP Stack (Base,
  Optimism) el recibo trae este segundo componente en el campo `l1Fee`, y `compare-costs.mjs` lo suma.
- **Arbitrum** reporta la parte de L1 de otra manera (dentro del gas usado), así que el script no la separa: el
  total sigue siendo correcto, pero la columna `l1Fee` va a aparecer en cero.
- Los precios del gas cambian a cada momento y en testnets son poco representativos. Conviene repetir la medición
  varias veces y anotar la fecha.
- La comparación conceptual (costo de gas, frecuencia esperada de reclamos y experiencia de usuario) es parte del
  documento de arquitectura. Estos números sirven para respaldarla con datos propios.
