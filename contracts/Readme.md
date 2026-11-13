# Contratos (Foundry)

Estos son los smart contracts del proyecto, con sus tests y el script de deploy. Las instrucciones paso a paso para instalar, desplegar y usar la dApp están en el [README de la raíz](../README.md). Las decisiones de diseño están en [`docs/DECISIONES_DEFENSA.md`](../docs/DECISIONES_DEFENSA.md).

## Estructura

| Archivo | Qué es |
|---|---|
| `src/IVestingManager.sol` | Interfaz: struct `Agreement`, estados, eventos, custom errors y funciones |
| `src/VestingManager.sol` | Contrato de vesting: crear, reclamar, cancelar y lecturas |
| `src/VestingManagerUpgradeable.sol` | Variante UUPS para usar detrás de un proxy (desafío B) |
| `src/MockToken.sol` | Token ERC-20 de prueba (OpenZeppelin) con decimales configurables y `mint` abierto |
| `src/MockPermitToken.sol` | Igual que `MockToken`, con soporte de Permit EIP-2612 (desafío E) |
| `script/Deploy.s.sol` | Despliega los dos tokens de prueba y el VestingManager, y escribe las direcciones en `../frontend/public/deployments.json` |
| `script/DeployUpgradeable.s.sol` | Despliega la variante upgradeable: implementación y proxy (desafío B) |
| `script/MeasureOps.s.sol` y `script/compare-costs.mjs` | Miden y comparan el costo de las operaciones entre redes (desafío D, ver `docs/DEPLOY_L2.md`) |
| `test/VestingManager.t.sol` | Tests unitarios, de fuzzing y de reentrancy |
| `test/VestingInvariant.t.sol` | Tests de invariantes, con un handler que llama a create, claim, cancel y warp en orden aleatorio |
| `test/VestingCliff.t.sol`, `VestingBatch.t.sol`, `VestingPermit.t.sol`, `VestingUpgradeable.t.sol` | Tests de los desafíos opcionales A, C, E y B |
| `test/mocks/ReentrantToken.sol` | Token malicioso que intenta reentrar durante la transferencia |
| `test/mocks/FeeToken.sol` | Token que cobra comisión al transferir, para probar que se rechaza |
| `test/mocks/VestingManagerUpgradeableV2.sol` | Versión 2 de prueba, para comprobar que un upgrade conserva los acuerdos |

Las dependencias están en `lib/` como submódulos de Git: OpenZeppelin y forge-std. Si `lib/` está vacía, correr `git submodule update --init --recursive` desde la raíz del repo.

## Comandos

```bash
forge build                       # compilar
forge test                        # correr los tests
forge test -vv                    # tests con más detalle
forge coverage --report summary   # coverage por archivo
forge coverage --report lcov      # genera lcov.info
forge fmt                         # formatear el código
```

## Deploy en Anvil

Con `anvil --block-time 1` corriendo en otra terminal:

```bash
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

El script despliega, en este orden:

| Contrato | Dirección en un Anvil recién iniciado |
|---|---|
| `MockToken` ("Test USD", `tUSD`, 6 decimales) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `MockPermitToken` ("Permit USD", `pUSD`, 6 decimales, con EIP-2612) | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `VestingManager` | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

La dirección de un contrato sale de la cuenta que despliega y de su nonce, así que depende de este orden: si se agrega o se mueve un deploy en el script, las direcciones cambian. Después le da 1.000.000 de cada token a la cuenta #0 de Anvil y agrega las direcciones de esta red a `../frontend/public/deployments.json`, sin borrar las de otras redes.

`foundry.toml` da permiso de escritura solo sobre `../frontend/public` (`fs_permissions`), que es donde el script deja ese archivo.

## Configuración de los tests

En `foundry.toml`, los invariantes corren 64 secuencias de 40 llamadas cada una, con `fail_on_revert = false`. Esa cantidad alcanza para encontrar errores y deja que la suite tarde un par de segundos.
