# Deploy en L2 y comparación de costos (desafío opcional D)

> **Estado: ejecutado el 13/11/2026 en Sepolia (L1) y en Base Sepolia (L2).** Los resultados están en
> [Resultados en redes reales](#resultados-en-redes-reales). La cuenta usada es solo de pruebas y su clave no está
> en el repo.

## Qué quedó listo

| Pieza | Para qué sirve |
|---|---|
| `[rpc_endpoints]` en `contracts/foundry.toml` | Alias `sepolia`, `base_sepolia`, `arbitrum_sepolia` y `anvil`. Las URL salen de variables de entorno: no hay claves ni URL privadas en el repo. |
| `script/Deploy.s.sol` | El mismo script de deploy de siempre sirve para cualquier red. |
| `script/MeasureOps.s.sol` | Ejecuta las operaciones relevantes sobre un contrato ya desplegado: `mint`, `approve`, `createAgreement`, `claim`, `createAgreement` y `cancel`. |
| `script/compare-costs.mjs` | Lee el resultado de `forge script` (`broadcast/.../run-latest.json`) y muestra el gas, el `l1Fee` y el costo en ETH de cada transacción. |

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

Si solo conseguís ETH en Sepolia, podés pasar una parte a Base Sepolia con el puente oficial: se le manda ETH al
contrato `L1StandardBridge` de Base, que está en Sepolia, y llega a la misma dirección en Base Sepolia en unos
minutos. La dirección del puente está en la documentación de Base (*Base Contracts → Ethereum Testnet (Sepolia)*):

```bash
cast send 0xfd0Bf71F60660E2f608ed56e1659C450eB113120 --value 0.01ether --account deployer --rpc-url sepolia
```

### 2. Configurar las URL de las redes

Se pueden usar RPC públicos, que no piden clave. Si fallan o andan lentos, un proveedor como Alchemy o Infura (con
cuenta gratuita). En ese caso la URL incluye tu clave, así que va solo en variables de entorno y **no** se sube al
repo:

```bash
export SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
export BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
```

Las variables duran mientras esté abierta la terminal. Los alias `sepolia` y `base_sepolia` se leen de
`foundry.toml`, así que los comandos se corren dentro de `contracts/`.

### 3. Desplegar en cada red

```bash
forge script script/Deploy.s.sol --rpc-url sepolia --account deployer --broadcast --slow
forge script script/Deploy.s.sol --rpc-url base_sepolia --account deployer --broadcast --slow
```

`--slow` espera a que se confirme cada transacción antes de mandar la siguiente, lo que evita errores de nonce con
RPC públicos.

`Deploy.s.sol` guarda las direcciones de cada red en `frontend/public/deployments.json`, indexadas por `chainId`
(Sepolia = `11155111`, Base Sepolia = `84532`).

> **Ojo:** el script escribe `deployments.json` aunque se corra **sin** `--broadcast`. En ese caso las direcciones
> quedan anotadas sin haberse desplegado. Si pasa, borrá esa entrada o repetí el deploy con `--broadcast`.

### 4. Medir las operaciones

Las direcciones se toman de `deployments.json` (`vestingManager` y `mockToken` de cada red). Para Sepolia:

```bash
export VESTING=$(node.exe -p "require('../frontend/public/deployments.json')['11155111'].vestingManager")
export TOKEN=$(node.exe -p "require('../frontend/public/deployments.json')['11155111'].mockToken")
echo $VESTING $TOKEN
forge script script/MeasureOps.s.sol --rpc-url sepolia --account deployer --broadcast --slow
```

Para Base Sepolia, lo mismo con `84532` y `--rpc-url base_sepolia`. Si el `echo` sale vacío o da
`Cannot read properties of undefined`, falta el deploy en esa red.

En Git Bash hay que usar `node.exe` y no `node`: dentro de `$(...)`, `node` pasa por `winpty` y falla con
`stdout is not a tty`.

### 5. Ver los costos

```bash
node.exe script/compare-costs.mjs broadcast/MeasureOps.s.sol/11155111/run-latest.json broadcast/MeasureOps.s.sol/84532/run-latest.json
```

## Resultados medidos en local (Anvil)

El **gas usado** depende del código del contrato y de las **reglas de gas del hardfork** que tenga cada red. Anvil
1.9.0 usa por defecto las de Osaka. Ver [Por qué Sepolia gasta más gas](#por-qué-sepolia-gasta-más-gas).
Estos valores salieron de `MeasureOps` contra Anvil, medidos el 13/11/2026 con el contrato que ya incluye los
desafíos A, C y E:

| Operación | Gas usado (Anvil) |
|---|---|
| `mint` (token de prueba) | 34.687 |
| `approve` | 46.892 |
| `createAgreement` (el primero, con storage nuevo) | 262.297 |
| `claim` | 78.248 |
| `createAgreement` (el segundo) | 206.197 |
| `cancel` | 81.486 |
| **Total** | **709.807** |

Una medición anterior dio unos 10 de gas más por operación (por ejemplo, 262.310 en el primer `createAgreement`).
La diferencia es tan chica que no cambia ninguna conclusión. Si se cambia el contrato, conviene volver a medir.

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
- `compare-costs.mjs` compara dos corridas: el **gas usado es idéntico** en ambas redes y el costo en ETH cambia
  según el precio del gas.

Última corrida (13/11/2026, firmando con `--unlocked`):

| Operación | Gas usado (las dos redes) | Costo red 31337 (ETH) | Costo red 31338 (ETH) |
|---|---|---|---|
| `createAgreement` (el primero) | 262.297 | 0,000007501 | 0,000002946 |
| `claim` | 78.248 | 0,000001963 | 0,000000771 |
| `cancel` | 81.486 | 0,000001569 | 0,000000616 |
| **Total de las 6 transacciones** | **709.807** | **0,000018390** | **0,000007222** |

Control a mano, `createAgreement` en la red 31337: 262.297 de gas × 0,028598 gwei ≈ 0,0000075 ETH, que coincide con lo
que muestra el script.

La red 31338 salió más barata aunque se levantó con un precio de gas más alto. En Anvil el *base fee* baja con cada
bloque vacío y el precio final depende de cómo lo estima Foundry en cada momento, así que no hay que sacar
conclusiones de esa diferencia. Estos costos en ETH no dicen nada de Sepolia ni de una L2: solo muestran que el
script los calcula bien.

El `l1Fee` no se puede probar en Anvil, porque siempre vale cero. Se comprobó después en Base Sepolia (ver abajo).

## Resultados en redes reales

Medido el **13/11/2026** con `MeasureOps.s.sol`, la misma cuenta de pruebas en las dos redes y el mismo código.
Todas las transacciones terminaron con `status 1`. Los links llevan al explorador de cada red, donde se puede
verificar todo lo que sigue.

| | Sepolia (L1, chainId 11155111) | Base Sepolia (L2, chainId 84532) |
|---|---|---|
| Cuenta de pruebas | [`0xE85bE348D181e04911F49B8ff64FFDaa8b9C244c`](https://sepolia.etherscan.io/address/0xE85bE348D181e04911F49B8ff64FFDaa8b9C244c) | [`0xE85bE348D181e04911F49B8ff64FFDaa8b9C244c`](https://sepolia.basescan.org/address/0xE85bE348D181e04911F49B8ff64FFDaa8b9C244c) |
| `VestingManager` | [`0xd95BCC4b0994A81a9C7bdD60A18291E9705Ce8C6`](https://sepolia.etherscan.io/address/0xd95BCC4b0994A81a9C7bdD60A18291E9705Ce8C6) | [`0x200527a97c5C83650B5cd2Fd07937e2A189bF84A`](https://sepolia.basescan.org/address/0x200527a97c5C83650B5cd2Fd07937e2A189bF84A) |
| `MockToken` | [`0x200527a97c5C83650B5cd2Fd07937e2A189bF84A`](https://sepolia.etherscan.io/address/0x200527a97c5C83650B5cd2Fd07937e2A189bF84A) | [`0x1b3601a21dcdA0e3dc2249f49Ea204d9C4C82b89`](https://sepolia.basescan.org/address/0x1b3601a21dcdA0e3dc2249f49Ea204d9C4C82b89) |

La misma dirección aparece como `MockToken` en Sepolia y como `VestingManager` en Base Sepolia. Es una casualidad:
la dirección sale de la cuenta y de su nonce, y en Sepolia la cuenta ya había mandado transacciones antes del deploy.

Salida de `compare-costs.mjs`, tal como la imprimió el script:

```
=== broadcast/MeasureOps.s.sol/11155111/run-latest.json  (chainId 11155111)
operacion            gas usado         gwei     l1Fee (wei)   costo total (ETH)
mint                     43087     0.050000               0         0.000002154
approve                 128812     0.050000               0         0.000006441
createAgreement        1069977     0.050000               0         0.000053499
claim                   175068     0.050000               0         0.000008753
createAgreement         764601     0.050000               0         0.000038230
cancel                  185406     0.050000               0         0.000009270
TOTAL                  2366951                                      0.000118348

=== broadcast/MeasureOps.s.sol/84532/run-latest.json  (chainId 84532)
operacion            gas usado         gwei     l1Fee (wei)   costo total (ETH)
mint                     34687     0.005000             752         0.000000173
approve                  46892     0.005000             752         0.000000234
createAgreement         262297     0.005000             963         0.000001311
claim                    78248     0.005000             752         0.000000391
createAgreement         206197     0.005000             878         0.000001031
cancel                   81486     0.005000             686         0.000000407
TOTAL                   709807                                      0.000003549
```

La misma información, ordenada para comparar:

| Operación | Sepolia: gas | Sepolia: costo (ETH) | Base Sepolia: gas | Base Sepolia: `l1Fee` (wei) | Base Sepolia: costo (ETH) | Sepolia / Base |
|---|---|---|---|---|---|---|
| `mint` | 43.087 | 0,000002154 | 34.687 | 752 | 0,000000173 | ≈ 12× |
| `approve` | 128.812 | 0,000006441 | 46.892 | 752 | 0,000000234 | ≈ 28× |
| `createAgreement` (el primero) | 1.069.977 | 0,000053499 | 262.297 | 963 | 0,000001311 | ≈ 41× |
| `claim` | 175.068 | 0,000008753 | 78.248 | 752 | 0,000000391 | ≈ 22× |
| `createAgreement` (el segundo) | 764.601 | 0,000038230 | 206.197 | 878 | 0,000001031 | ≈ 37× |
| `cancel` | 185.406 | 0,000009270 | 81.486 | 686 | 0,000000407 | ≈ 23× |
| **Total** | **2.366.951** | **0,000118348** | **709.807** | | **0,000003549** | **≈ 33×** |

Precio del gas en el momento de la medición: **0,05 gwei en Sepolia** y **0,005 gwei en Base Sepolia**.

Las 6 transacciones de la medición en cada red, en el orden en que se ejecutaron:

| Operación | Sepolia | Base Sepolia |
|---|---|---|
| `mint` | [`0x538f50c3…21be0ca7`](https://sepolia.etherscan.io/tx/0x538f50c32a15ebc970946b7d55b2b8c01b8c0ae41910798bc8a1d2f921be0ca7) | [`0x49c42af5…b14a77f1`](https://sepolia.basescan.org/tx/0x49c42af52b61e56919dc757dc146125a8b4491c33500d05c8afa1a31b14a77f1) |
| `approve` | [`0x7f999a49…12381940`](https://sepolia.etherscan.io/tx/0x7f999a49ed732858c0bf34684e350dfd1cebe71780153cf0a58099f712381940) | [`0x2193c7e9…d4fe2267`](https://sepolia.basescan.org/tx/0x2193c7e976939e7abb4b5c205fef2b5bd0c45a93b4b458ef37219982d4fe2267) |
| `createAgreement` (el primero) | [`0x3e90646d…89c60f61`](https://sepolia.etherscan.io/tx/0x3e90646dae12c4a6efb26bcfd765cd5c40d349e42dd21849c6c5e38689c60f61) | [`0xd95d3731…9d912bc3`](https://sepolia.basescan.org/tx/0xd95d3731348d6b5621b3f883c80d166b3db42dabf3f12ff70d3216409d912bc3) |
| `claim` | [`0xa004ddae…aeb6f2a6`](https://sepolia.etherscan.io/tx/0xa004ddae40cb7afa2fc24ebe745dff6059d2eb9c2fda51cf9535235caeb6f2a6) | [`0x41ae13b0…6c3e62a5`](https://sepolia.basescan.org/tx/0x41ae13b053ace2b74e5a8a1c11eec1d130fc951eb8143b1cb75e7c8a6c3e62a5) |
| `createAgreement` (el segundo) | [`0xf644dfb0…326b6ff8`](https://sepolia.etherscan.io/tx/0xf644dfb0d658d9da303effa90d7d377f277a1085c8756d392a0e2369326b6ff8) | [`0x1260b573…3d5efc1b`](https://sepolia.basescan.org/tx/0x1260b573309ebf6bbed18de784e7ddcceea12c8a87c10f0176f1c2f43d5efc1b) |
| `cancel` | [`0x42012561…f95aa4cc`](https://sepolia.etherscan.io/tx/0x42012561809ae01ae7d16a57f69576463d2d897c4a9343e76e38fce6f95aa4cc) | [`0x04d27b17…fba39408`](https://sepolia.basescan.org/tx/0x04d27b17150b0b61f564c333db044e469bfd4ffcc9bfde254fd2f804fba39408) |

En el detalle de cada transacción de Base Sepolia, el explorador muestra por separado el costo de ejecución en la L2
y el de publicar los datos en L1 (el `l1Fee`).

### Qué muestran los números

- **En total, en Base Sepolia todo costó unas 33 veces menos que en Sepolia.** Esa diferencia sale de dos factores
  que se multiplican: el gas costaba 10 veces menos (0,005 contra 0,05 gwei) y las mismas operaciones gastaron
  3,3 veces menos gas.
- **Lo que más se abarata es crear un acuerdo** (≈ 41×), porque es la operación que más storage nuevo escribe. Reclamar
  y cancelar se abaratan ≈ 22×.
- **El `l1Fee` existe pero es despreciable en testnet:** entre 686 y 963 wei por transacción, frente a cientos de
  miles de millones de wei de ejecución. El recibo informaba un `l1GasPrice` de 15 wei, porque el *base fee* de
  Sepolia era muy bajo. En mainnet el precio de L1 es mucho más alto, y ahí el `l1Fee` puede ser una parte importante
  del costo de una L2.
- **Los precios absolutos no son representativos.** En mainnet el gas suele estar bastante por encima de 0,05 gwei,
  y en las testnets el precio depende de cuánta gente las use. Lo que se puede sostener es la relación entre las dos
  redes y el gas usado por operación.

### Por qué Sepolia gasta más gas

En Base Sepolia el gas usado es **idéntico** al de Anvil. En Sepolia es entre 1,2 y 4 veces mayor, con el mismo
código. La causa es que Sepolia ya tiene activadas las reglas de gas del hardfork **Amsterdam**, que encarece mucho
crear storage nuevo (EIP-8037). Base Sepolia y Anvil todavía usan las anteriores (Osaka).

Cómo se comprobó, con el mismo `approve` de un token recién desplegado a un `spender` nuevo:

| Entorno | Gas del `approve` |
|---|---|
| Anvil con `--hardfork osaka` | 46.664 |
| Anvil con `--hardfork amsterdam` | 128.584 |
| Copia local de Sepolia (`anvil --fork-url`) | 128.584 |

Coincide con el patrón de la tabla: `mint`, que modifica un saldo que ya existía, sube poco (43.087 contra 34.687).
`approve` y `createAgreement`, que escriben slots que estaban en cero, suben mucho.

**Consecuencia:** el factor de 3,3 en el gas depende del momento. Cuando Base adopte Amsterdam, su gas usado va a
subir como el de Sepolia, y la diferencia entre las redes va a quedar dada sobre todo por el precio del gas.

## Cómo leer la comparación

- En una L2 el costo de una transacción tiene dos partes: la **ejecución en la L2** (gas usado × precio del gas de
  la L2, normalmente muy bajo) y la **publicación de los datos en L1**. En las redes tipo OP Stack (Base,
  Optimism) el recibo trae este segundo componente en el campo `l1Fee`. Foundry lo guarda en `run-latest.json`
  (comprobado en Base Sepolia), y `compare-costs.mjs` lo muestra en wei y lo suma al costo total.
- **Arbitrum** reporta la parte de L1 de otra manera (dentro del gas usado), así que el script no la separa: el
  total sigue siendo correcto, pero la columna `l1Fee` va a aparecer en cero.
- Los precios del gas cambian a cada momento y en testnets son poco representativos. Conviene repetir la medición
  varias veces y anotar la fecha.
- La comparación conceptual (costo de gas, frecuencia esperada de reclamos y experiencia de usuario) es parte del
  documento de arquitectura. Estos números sirven para respaldarla con datos propios.
