# Desafíos opcionales

Cada desafío tiene su propio commit en la rama `feature/optional-challenges`. Todos los cambios al contrato
son **aditivos**: las firmas, el struct `Agreement` y los eventos que ya usa la dApp de Angular no cambian.

## A. Cliff de vesting

**Qué hace.** Un acuerdo puede tener un `cliffTime`. Antes del cliff no se devenga ni se puede reclamar nada.
Desde el cliff se respeta el vesting lineal **calculado desde `startTime`** (no desde el cliff).

```
t < cliff                      -> 0
cliff <= t <= start            -> 0
start < t < end                -> total * (t - start) / (end - start)
t >= end                       -> total
```

**Cómo se usa.**

- `createAgreement(...)`: sin cliff, igual que antes.
- `createAgreementWithCliff(token, beneficiary, amount, startTime, cliffTime, endTime, revocable)`.
- `cliffOf(id)`: devuelve el cliff (0 si no tiene).
- Si el acuerdo tiene cliff se emite `CliffConfigured(id, cliffTime)` justo después de `AgreementCreated`.

**Reglas.**

- `cliffTime` debe estar en `[startTime, endTime]`; si no, `InvalidCliff`. Un cliff `0` explícito se rechaza: para
  "sin cliff" se usa `createAgreement`.
- Cancelar **antes del cliff** devuelve todo al pagador (el beneficiario todavía no devengó nada).
- Cancelar **después del cliff** congela lo devengado, como en un acuerdo normal.
- Con `cliffTime == endTime` el acuerdo es "todo o nada": 0 hasta el final y el total al llegar a `endTime`.

**Decisión de diseño (para la defensa).** El cliff se guarda en `mapping(uint256 id => uint48) _cliffTime` y no
como campo del struct. Así `getAgreement`, `getAgreements` y `AgreementCreated` mantienen exactamente el mismo
ABI y la dApp sigue funcionando sin cambios. El costo es una lectura de storage extra (`SLOAD`) al calcular el
devengado.

**Tests.** `contracts/test/VestingCliff.t.sol`: validaciones, nada antes del cliff, valor exacto en el cliff y
después, cliff igual a inicio o fin, cancelar antes y después del cliff, `getAgreements` y fuzzing.

## C. Batch payroll

**Qué hace.** `createAgreementsBatch(token, beneficiaries[], amounts[], startTime, endTime, revocable)` crea un
acuerdo por beneficiario (mismo período y misma revocabilidad) en **una sola transacción**, y cobra al pagador
**una única `transferFrom` por la suma** de los montos. Devuelve los ids en el mismo orden que `beneficiaries`.

**Reglas.**

- Es atómico: si un elemento es inválido (monto 0, beneficiario inválido, fechas, token) se revierte todo el lote
  y no se mueve ningún fondo. Se valida todo antes de transferir.
- `EmptyBatch` si no hay destinatarios y `LengthMismatch` si los arreglos tienen distinto largo.
- Cada acuerdo emite su propio `AgreementCreated`, así la dApp y el historial no necesitan cambios.
- Un mismo beneficiario puede aparecer más de una vez.
- La protección contra tokens con comisión se aplica sobre la suma.
- Un solo `approve` por el total alcanza para todo el lote.

**Análisis de gas** (test `test_batch_isCheaperThanIndividualCreations`, 10 acuerdos, mismo estado inicial con
`vm.snapshotState`):

| Forma de crear | Gas |
|---|---|
| 10 llamadas a `createAgreement` | 2.338.087 |
| 1 llamada a `createAgreementsBatch` con 10 elementos | 1.795.728 |
| **Ahorro** | **23%** |

De dónde sale el ahorro: se evita pagar 9 veces el costo base de transacción, 9 `transferFrom` (cada una con sus
lecturas y escrituras de balance y allowance), 9 entradas y salidas de `nonReentrant` y la repetición de los datos
del token y de las fechas. Lo que **no** se ahorra es el almacenamiento de cada acuerdo, que cuesta lo mismo.

**`calldata` y `memory`.** `beneficiaries` y `amounts` entran como `calldata` (solo se leen) y `ids` se devuelve
en `memory`, porque es un arreglo nuevo que se arma y se devuelve.

**Tests.** `contracts/test/VestingBatch.t.sol`: creación, un solo cobro por la suma, eventos, reclamo y cancelación
individuales, atomicidad ante un elemento inválido, allowance insuficiente, token con comisión y la comparación de
gas.

## E. Permit (EIP-2612)

**Qué hace.** `createAgreementWithPermit(token, beneficiary, amount, startTime, endTime, revocable, sig)` permite
que el pagador cree el acuerdo en **una sola transacción**: en lugar de enviar antes un `approve`, firma off-chain
un mensaje EIP-2612 y el contrato llama a `permit` con esa firma y después cobra con `transferFrom`.

```
Antes:  tx 1 approve(vesting, amount)   +   tx 2 createAgreement(...)
Ahora:  firma off-chain (gratis)        +   tx 1 createAgreementWithPermit(..., sig)
```

`sig` es un struct `PermitSignature { deadline, v, r, s }` en `calldata`. Se agrupó la firma en un struct, y no en
cuatro parámetros sueltos, para que la función no llegue a diez parámetros: con tantos, Solidity corre riesgo de
dar el error *stack too deep*. No se probó la variante con parámetros sueltos; es una decisión de legibilidad y
prevención.

**Decisiones de seguridad (para la defensa).**

- **`permit` va dentro de un `try/catch`.** La firma viaja visible en el mempool y cualquiera puede ejecutar
  `token.permit(...)` antes que nosotros. Si el contrato llamara a `permit` sin protección, esa llamada
  adelantada haría revertir la creación (ataque de *griefing*). Con el `try/catch` el fallo se ignora y el cobro
  funciona igual porque la allowance ya quedó otorgada. Si la allowance no alcanza, `_pull` revierte con
  `ERC20InsufficientAllowance`.
- **Se aprueba exactamente `amount`.** El `transferFrom` consume toda la allowance, así que no queda una
  aprobación abierta.
- **Solo funciona para el que llama.** `permit` se evalúa con `owner = msg.sender`, así que nadie puede usar la
  firma de otro para gastar sus tokens.
- **Un token sin soporte de permit** sigue funcionando si el pagador ya hizo `approve`: la llamada a `permit` falla
  dentro del `try/catch`, se ignora y se usa la allowance existente.
- Las validaciones comunes (token, monto, beneficiario, fechas) corren **antes** de llamar a `permit`, para no
  gastar la firma en una creación que iba a fallar.

**Límite conocido.** Un token con una función `fallback` que acepte cualquier llamada (como el WETH clásico) haría
que `permit` "tenga éxito" sin hacer nada. No es un problema de seguridad: el `transferFrom` posterior revierte si
no hay allowance.

**Token de prueba.** `MockPermitToken` (`contracts/src/MockPermitToken.sol`): ERC-20 con `ERC20Permit`, decimales
configurables y mint abierto. `Deploy.s.sol` lo despliega como `pUSD` y guarda su dirección en
`deployments.json` bajo la clave `mockPermitToken` (Angular la ignora).

**Tests.** `contracts/test/VestingPermit.t.sol`: creación sin approve, allowance consumida y nonce avanzado, firma
vencida, de otra clave, por otro monto o repetida, firma de otro usuario, front-running del permit, fallback a una
allowance existente, token sin permit y validaciones previas.

**Estado de la dApp.** La dApp de Angular sigue usando `approve` + `createAgreement`: sumar el flujo con firma
EIP-712 desde MetaMask es trabajo de frontend que no se hizo.
