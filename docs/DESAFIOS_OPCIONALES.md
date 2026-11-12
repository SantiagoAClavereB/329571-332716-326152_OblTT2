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
