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
