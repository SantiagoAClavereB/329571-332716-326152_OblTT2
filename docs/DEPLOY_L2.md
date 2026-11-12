# Deploy en L2 y comparación de costos (desafío opcional D)

> **Estado: preparado, pero NO ejecutado en una testnet.** Desplegar en una L2 real exige una cuenta con fondos de
> prueba y un RPC con clave, y esos datos no están en el repo. Todo lo de abajo se probó contra Anvil; falta
> correrlo en Sepolia y en una L2 (por ejemplo Base Sepolia) y completar la tabla de resultados.

## Qué quedó listo

| Pieza | Para qué sirve |
|---|---|
| `[rpc_endpoints]` en `contracts/foundry.toml` | Alias `sepolia`, `base_sepolia`, `arbitrum_sepolia` y `anvil`. Las URL salen de variables de entorno: no hay claves ni URL privadas en el repo. |
| `script/Deploy.s.sol` | El mismo script de deploy de siempre sirve para cualquier red. |
| `script/MeasureOps.s.sol` | Ejecuta las operaciones relevantes sobre un contrato ya desplegado: `mint`, `approve`, `createAgreement`, `claim`, `createAgreement` y `cancel`. |
| `script/compare-costs.mjs` | Lee el resultado de `forge script` (`broadcast/.../run-latest.json`) y muestra el gas y el costo en ETH de cada transacción. |

## Paso a paso

Todo se corre en Git Bash, dentro de la carpeta `contracts/`.

### 1. Preparar una cuenta de pruebas (una sola vez)

No pongas claves privadas en archivos del repo ni en la línea de comandos. Foundry puede guardarlas cifradas en tu
PC:

```bash
cast wallet import deployer --interactive
```

Te pide la clave privada de una cuenta **solo de pruebas** y una contraseña. Después la usás con `--account deployer`.
Esa cuenta necesita ETH de prueba en cada red (se pide en el *faucet* de la red).

### 2. Configurar las URL de las redes

Necesitás un proveedor de RPC (por ejemplo Alchemy o Infura, con cuenta gratuita). La URL incluye tu clave, así que
va en variables de entorno de tu sesión y **no** se sube al repo:

```bash
export SEPOLIA_RPC_URL="https://..."
export BASE_SEPOLIA_RPC_URL="https://..."
```

### 3. Desplegar en cada red

```bash
forge script script/Deploy.s.sol --rpc-url sepolia --account deployer --broadcast
forge script script/Deploy.s.sol --rpc-url base_sepolia --account deployer --broadcast
```

`Deploy.s.sol` guarda las direcciones de cada red en `frontend/public/deployments.json`, indexadas por `chainId`
(Sepolia = `11155111`, Base Sepolia = `84532`).

> **Ojo:** el script escribe `deployments.json` aunque se corra **sin** `--broadcast`. En ese caso las direcciones
> quedan anotadas sin haberse desplegado. Si pasa, borrá esa entrada o repetí el deploy con `--broadcast`.

### 4. Medir las operaciones

Tomá las direcciones de `deployments.json` (`vestingManager` y `mockToken` de cada red):

```bash
VESTING=0x... TOKEN=0x... forge script script/MeasureOps.s.sol --rpc-url sepolia --account deployer --broadcast
VESTING=0x... TOKEN=0x... forge script script/MeasureOps.s.sol --rpc-url base_sepolia --account deployer --broadcast
```

### 5. Ver los costos

```bash
node script/compare-costs.mjs broadcast/MeasureOps.s.sol/11155111/run-latest.json broadcast/MeasureOps.s.sol/84532/run-latest.json
```

## Resultados medidos en local (Anvil)

El **gas usado** depende solo del código del contrato y es la parte comparable entre redes compatibles con la EVM.
Estos valores salieron de `MeasureOps` contra Anvil:

| Operación | Gas usado (Anvil) |
|---|---|
| `mint` (token de prueba) | 34.689 |
| `approve` | 46.894 |
| `createAgreement` (el primero, con storage nuevo) | 262.310 |
| `claim` | 78.257 |
| `createAgreement` (el segundo) | 206.210 |
| `cancel` | 81.495 |

El segundo `createAgreement` sale más barato que el primero porque algunos slots de storage ya no están en cero.

## Prueba con dos redes locales

Para comprobar el flujo completo sin gastar fondos reales se levantó una segunda red Anvil con otro `chainId` y un
precio de gas distinto de cero, y se repitió todo con una cuenta guardada en un **keystore cifrado** (el mismo
mecanismo del paso 1, pero con `--keystore <archivo> --password ...` en lugar de `--account`):

```bash
anvil --port 8546 --chain-id 31338 --block-time 1 --block-base-fee-per-gas 1000000000 --gas-price 2000000000
```

Qué se comprobó:

- Firmar con el keystore funciona, tanto en `Deploy.s.sol` como en `MeasureOps.s.sol`.
- `deployments.json` guarda **las dos redes por `chainId`** sin pisar la entrada anterior.
- `compare-costs.mjs` compara dos corridas: el **gas usado es idéntico** en ambas redes (709.855 en total) y el costo
  en ETH cambia según el precio del gas. Control a mano: 262.310 de gas × 0,006574 gwei ≈ 0,0000017 ETH, que es lo
  que muestra `createAgreement`.

Qué **no** se comprobó, porque Anvil no lo reproduce:

- El campo `l1Fee` de las L2 tipo OP Stack: en Anvil siempre vale cero, así que no se sabe si `run-latest.json`
  lo incluye en los recibos de una L2 real. Si no lo trae, el costo de una L2 quedaría subestimado.
- El comportamiento de Arbitrum y de las URL de proveedores reales.

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
