# Decisiones de diseño para la defensa

Resumen de **qué se decidió, por qué y dónde está en el código**, para que los tres integrantes puedan explicarlo.
Código de referencia: [`contracts/src/VestingManager.sol`](../contracts/src/VestingManager.sol) y [`contracts/src/IVestingManager.sol`](../contracts/src/IVestingManager.sol).

## 1. Arquitectura

- **Un solo contrato** (`VestingManager`) guarda todos los acuerdos en `mapping(uint256 => Agreement)`. Desplegar un contrato por acuerdo costaría mucho más gas y complicaría la dApp.
- El token de pago es un **parámetro de cada acuerdo**, no del contrato. `MockToken` es solo el ERC-20 de prueba (decimales configurables, `mint` abierto).
- Los ids empiezan en **1**, así el id 0 nunca es válido y "no existe" se detecta con `payer == address(0)`.

## 2. Storage, memory y calldata (sección 10 de la letra)

### 2.1 Storage: struct empaquetado (`IVestingManager.Agreement`)
Los campos están ordenados para llenar slots de 32 bytes:

| Slot | Contenido | Bytes |
|---|---|---|
| 1 | `payer` + `startTime` (uint48) + `endTime` (uint48) | 20 + 6 + 6 = 32 |
| 2 | `beneficiary` + `status` (enum, 1 byte) + `revocable` (bool) | 20 + 1 + 1 = 22 |
| 3 | `token` | 20 |
| 4 a 6 | `totalAmount`, `claimedAmount`, `vestedAtCancel` (uint256) | 32 c/u |

- Un `uint48` guarda fechas hasta el año ~8,9 millones: sobra para timestamps y ahorra 26 bytes por fecha frente a `uint256`.
- Impacto: crear un acuerdo escribe 6 slots en vez de 10. Cada `SSTORE` a un slot nuevo es de las operaciones más caras de la EVM, así que se reduce el gas de `createAgreement`.
- Leer `startTime`, `endTime` y `payer` juntos cuesta un solo `SLOAD` (están en el mismo slot).

### 2.2 Storage: puntero en vez de copia (`_getStorage`)
- `Agreement storage a = _agreements[id];` es un **puntero** al storage: no copia nada. Solo se lee, con `SLOAD`, lo que realmente se usa.
- Si se escribiera `Agreement memory a = _agreements[id];` se copiarían los 6 slots a memoria aunque se use un solo campo.
- Además con el puntero se puede **modificar** el acuerdo (`a.claimedAmount += amount`), cosa que una copia en memoria no permite.

### 2.3 Memory: `getAgreement`
- `getAgreement` devuelve `Agreement memory`: es una **copia** pensada para quien lo llama desde afuera (la dApp). Una función `external view` no puede devolver un puntero a storage.
- Es el único lugar donde se paga la copia completa, y es una lectura (`view`), por lo que no cuesta gas al consultarla desde la dApp.

### 2.4 Calldata: `getAgreements(uint256[] calldata ids)`
- Regla: `calldata` sirve para parámetros **dinámicos** (`string`, `bytes`, arrays) de funciones `external`. Son de **solo lectura** y se leen directo de los datos de la transacción, sin copiarlos a memoria.
- Ejemplo real en el código: `getAgreements(uint256[] calldata ids)` es una lectura en lote para la dApp (una sola llamada trae el listado completo). El arreglo de ids entra en `calldata`, así que no se paga la copia a memoria de un arreglo de largo arbitrario.
- Las demás funciones de `VestingManager` reciben solo **tipos por valor** (`address`, `uint256`, `uint48`, `bool`), que no llevan ubicación de datos.
- Dentro de `getAgreements`, el resultado sí va en `memory` (`Agreement[] memory result = new Agreement[](ids.length)`): es un arreglo nuevo, de largo conocido, que se arma y se devuelve. Cada elemento se copia desde storage con `_getStorage(ids[i])`, y si algún id no existe revierte con `AgreementNotFound`.
- Contraste con `memory` obligatorio: en `MockToken` el constructor recibe `string memory name_` y `string memory symbol_`. En un constructor los parámetros dinámicos no pueden ir en `calldata`, deben ir en `memory`.
- Es la única función que se agregó después de congelar la interfaz; el grupo la aprobó. La dApp debe sumarla a `abis.ts`.

### 2.5 Mappings y listados
- `_idsByPayer` y `_idsByBeneficiary` son `mapping(address => uint256[])`. Guardan solo ids (32 bytes por acuerdo) y el acuerdo completo se lee aparte con `getAgreement`.
- Esto simplifica las pantallas "Acuerdos creados" e "Ingresos". El historial no se guarda en storage: se reconstruye con los **eventos**, que son más baratos que escribir storage.

## 3. Fórmula de vesting

```
t <= start        -> 0
t >= end          -> total
start < t < end   -> total * (t - start) / (end - start)
```

- Se implementa con `Math.mulDiv(total, t - start, end - start)` de OpenZeppelin.
- **Multiplica primero y divide después**: dividir antes perdería precisión (por ejemplo `(t-start)/(end-start)` da 0 o 1 en enteros).
- `mulDiv` usa 512 bits internos: el producto no hace overflow aunque `total` sea enorme.
- **Redondea hacia abajo**: el devengado nunca supera lo proporcional y, al final, `t >= end` devuelve exactamente `total`. No se puede reclamar más de lo depositado.
- `claimable = vested - claimed`.

## 4. Máquina de estados

```
            claim (retira todo)
  Active ----------------------> Completed
    |
    | cancel (solo si revocable, y antes de endTime)
    v
 Cancelled
```

- **Active:** vigente, acumula saldo.
- **Completed:** se alcanza cuando `claimedAmount == totalAmount`, dentro de `claim`.
- **Cancelled:** el pagador canceló un acuerdo revocable. No pasa a `Completed` aunque después se retire todo lo devengado.
- Desde `Completed` o `Cancelled` no se puede volver a cancelar (`NotActive`).

## 5. Cancelación

Orden de verificaciones en `cancel`: pagador → estado `Active` → revocable → antes de `endTime`.

- Se calcula lo devengado hasta ese instante y se **congela** en `vestedAtCancel`.
- Lo no devengado (`total - vested`) vuelve al pagador en la misma transacción.
- Lo devengado **queda a favor del beneficiario**, que lo reclama después con `claim`. Por eso un beneficiario malicioso no puede bloquear la cancelación.
- Cancelar **antes de `startTime`** devuelve todo al pagador (devengado = 0).
- Cancelar **exactamente en `endTime` o después** revierte con `AlreadyEnded`.
- Un acuerdo no revocable revierte con `NotRevocable`.

## 6. Seguridad

| Riesgo | Medida |
|---|---|
| Reentrancy | `nonReentrant` en `createAgreement`, `claim` y `cancel` + checks-effects-interactions: `claimedAmount` y el estado se actualizan **antes** de transferir. |
| Doble reclamo | `claimable = vested - claimed`; tras reclamar, `claimed` sube y un segundo reclamo revierte con `NothingToClaim`. |
| Acceso | `NotBeneficiary` en `claim`, `NotPayer` en `cancel`. |
| Cancelar lo no cancelable | `NotRevocable`, `NotActive` y `AlreadyEnded`. |
| Reclamo antes del inicio | devengado = 0, `NothingToClaim`. |
| Tiempos inválidos | `InvalidTimeRange` si `end <= start` o `end` ya pasó. |
| Redondeo | `mulDiv` hacia abajo; nunca se paga de más. |
| Beneficiario inválido | `InvalidBeneficiary` rechaza `address(0)` y `address(this)`. |
| Token con comisión | se compara el balance antes y después de `transferFrom`; si no coincide, `FeeOnTransferNotSupported`. |
| Tokens no estándar | `SafeERC20` (ver sección 8). |

- Errores: **custom errors** (más baratos en gas y en bytecode que `revert("string")`, y más fáciles de decodificar en la dApp).
- Eventos: `AgreementCreated`, `Claimed`, `AgreementCancelled`. El paso a `Completed` no tiene evento propio: lo marca el último `Claimed`.

## 7. Decisiones que la letra deja abiertas

| Tema | Decisión |
|---|---|
| Fecha de inicio en el pasado | **Se permite**, pero `endTime` debe ser futura y posterior al inicio. |
| Cancelar antes de `startTime` | Se devuelve todo al pagador. |
| Evento de acuerdo completado | No hay evento aparte; alcanza con `Claimed`. |
| Tokens con comisión | No soportados: se revierte. |

## 8. ERC-20: lo que hay que saber explicar

- **`approve(spender, amount)`:** el dueño autoriza a otro contrato o cuenta a gastar hasta `amount` de sus tokens.
- **`allowance(owner, spender)`:** cuánto puede todavía gastar el `spender` en nombre del `owner`.
- **`transferFrom(from, to, amount)`:** mueve tokens de `from` a `to` usando la allowance. Es lo que usa `createAgreement` para tomar el dinero del pagador (por eso hace falta `approve` antes).
- **`transfer(to, amount)`:** el dueño envía sus propios tokens. Es lo que usa el contrato para pagar en `claim` y devolver en `cancel`.
- **`SafeERC20`:** algunos tokens no devuelven `bool` o devuelven `false` en vez de revertir. `SafeERC20` verifica el resultado y revierte si la transferencia falló, para no dar por buena una transferencia que no ocurrió.
- Flujo en la dApp: `approve` → `createAgreement`. Esto es **dos transacciones**; Permit (EIP-2612) lo reduciría a una pero es opcional.

## 9. Avisos del linter de Foundry

`forge build` muestra avisos que están revisados y son aceptables:

- `block-timestamp`: el vesting depende del tiempo por definición. Las fechas se miden en segundos, por lo que una desviación de unos segundos de los validadores no es relevante.
- `reentrancy-events`: los eventos de `createAgreement` y `claim` se emiten cerca de llamadas externas, pero las tres funciones están protegidas con `nonReentrant`.
- `incorrect-strict-equality`: `claimedAmount == totalAmount` es la condición exacta de "completado".
