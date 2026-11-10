# Contratos (Foundry)

Estos son los smart contracts del proyecto, con sus tests y el script de deploy. Las instrucciones paso a paso para instalar, desplegar y usar la dApp están en el [README de la raíz](../README.md). Las decisiones de diseño están en [`docs/DECISIONES_DEFENSA.md`](../docs/DECISIONES_DEFENSA.md).

## Estructura

| Archivo | Qué es |
|---|---|
| `src/IVestingManager.sol` | Interfaz: struct `Agreement`, estados, eventos, custom errors y funciones |
| `src/VestingManager.sol` | Contrato de vesting: crear, reclamar, cancelar y lecturas |
| `src/MockToken.sol` | Token ERC-20 de prueba (OpenZeppelin) con decimales configurables y `mint` abierto |
| `script/Deploy.s.sol` | Despliega el token y el VestingManager, y escribe las direcciones en `../frontend/public/deployments.json` |
| `test/VestingManager.t.sol` | Tests unitarios, de fuzzing y de reentrancy |
| `test/VestingInvariant.t.sol` | Tests de invariantes, con un handler que llama a create, claim, cancel y warp en orden aleatorio |
| `test/mocks/ReentrantToken.sol` | Token malicioso que intenta reentrar durante la transferencia |
| `test/mocks/FeeToken.sol` | Token que cobra comisión al transferir, para probar que se rechaza |

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

El script despliega `MockToken` ("Test USD", `tUSD`, 6 decimales) y `VestingManager`. Le da 1.000.000 tUSD a la cuenta #0 de Anvil y agrega las direcciones de esta red a `../frontend/public/deployments.json`, sin borrar las de otras redes.

`foundry.toml` da permiso de escritura solo sobre `../frontend/public` (`fs_permissions`), que es donde el script deja ese archivo.

## Configuración de los tests

En `foundry.toml`, los invariantes corren 64 secuencias de 40 llamadas cada una, con `fail_on_revert = false`. Esa cantidad alcanza para encontrar errores y deja que la suite tarde un par de segundos.
