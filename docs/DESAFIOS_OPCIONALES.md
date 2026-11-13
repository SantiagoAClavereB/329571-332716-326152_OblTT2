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

**Tests.** `contracts/test/VestingCliff.test.js`: validaciones, nada antes del cliff, valor exacto en el cliff y
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

**Análisis de gas** (test «el lote sale mas barato que crear los acuerdos de a uno», 10 acuerdos, mismo estado
inicial con `takeSnapshot`; suma del `gasUsed` de los recibos):

| Forma de crear | Gas |
|---|---|
| 10 llamadas a `createAgreement` | 2.237.558 |
| 1 llamada a `createAgreementsBatch` con 10 elementos | 1.753.061 |
| **Ahorro** | **21%** |

De dónde sale el ahorro: se evita pagar 9 veces el costo base de transacción, 9 `transferFrom` (cada una con sus
lecturas y escrituras de balance y allowance), 9 entradas y salidas de `nonReentrant` y la repetición de los datos
del token y de las fechas. Lo que **no** se ahorra es el almacenamiento de cada acuerdo, que cuesta lo mismo.

**`calldata` y `memory`.** `beneficiaries` y `amounts` entran como `calldata` (solo se leen) y `ids` se devuelve
en `memory`, porque es un arreglo nuevo que se arma y se devuelve.

**Tests.** `contracts/test/VestingBatch.test.js`: creación, un solo cobro por la suma, eventos, reclamo y cancelación
individuales, atomicidad ante un elemento inválido, allowance insuficiente, token con comisión y la comparación de
gas.

## B. Upgradeabilidad (UUPS)

**Qué hace.** `VestingManagerUpgradeable` es una variante de `VestingManager` pensada para usarse detrás de un
proxy ERC-1967 con el patrón **UUPS**. El estado (acuerdos, ids, listados, cliffs, fondos) vive en el **proxy**; un
upgrade cambia solo la lógica a la que apunta, sin tocar los datos.

```
dApp --> Proxy (ERC1967Proxy)  --delegatecall-->  Implementación V1  (upgradeToAndCall)-->  Implementación V2
         guarda el estado y los fondos            solo lógica                                solo lógica
```

**Diseño.**

- Es un contrato **aparte** que hereda de `VestingManager` + `Initializable` + `UUPSUpgradeable` de OpenZeppelin
  (ya incluidos en la librería del proyecto, no se agregó ninguna dependencia). El contrato original no upgradeable
  sigue siendo el que se despliega por defecto. El único cambio en él es `_nextId` de `private` a `internal`.
- **`initialize(owner)`** reemplaza al constructor: fija el dueño y `_nextId = 1` (detrás de un proxy el valor
  inicial de la declaración no se aplica). Solo puede llamarse una vez (`initializer`).
- **El constructor de la implementación llama a `_disableInitializers()`**, así nadie puede inicializar ni tomar
  el control de la implementación directamente.
- **`_authorizeUpgrade`** exige ser el `owner`. En UUPS esa autorización vive en la implementación: si una versión
  nueva la perdiera, el proxy no podría volver a actualizarse.
- `transferOwnership(newOwner)` permite cambiar de dueño.

**Cómo se demuestra que un upgrade conserva los acuerdos** (test «conserva todos los acuerdos, saldos e ids»):

1. Se crean 4 acuerdos en estados distintos: uno activo con un reclamo parcial, uno no revocable, uno con cliff
   que se cancela y uno completado.
2. Se guarda el hash de `getAgreements` de los 4, de las listas por pagador y beneficiario, el balance de tokens
   del proxy y el cliff.
3. El owner actualiza a una `V2` de prueba, que agrega una variable de estado nueva al final del storage, una
   función `version()` y una migración `initializeV2()` (`reinitializer(2)`).
4. Se comprueba que la implementación cambió y que **todos los hashes y balances son idénticos**.
5. Un segundo test confirma que después del upgrade los reclamos siguen respetando lo ya reclamado, un acuerdo no
   revocable sigue sin poder cancelarse y los ids nuevos continúan la numeración.

**Seguridad.**

| Riesgo | Medida |
|---|---|
| Que cualquiera actualice | `onlyOwner` en `_authorizeUpgrade` (probado con un tercero y con el pagador) |
| Inicializar de nuevo el proxy | `initializer`: la segunda llamada revierte con `InvalidInitialization` |
| Tomar la implementación | `_disableInitializers()` en su constructor |
| Actualizar a un contrato que no es UUPS | OpenZeppelin lo rechaza con `ERC1967InvalidImplementation` |
| Llamar `upgradeToAndCall` en la implementación | Revierte con `UUPSUnauthorizedCallContext` |
| Migración repetida | `reinitializer(2)`: no puede ejecutarse dos veces |

**Limitaciones conocidas.**

- **Riesgo de confianza.** El `owner` puede reemplazar la lógica y, en teoría, mover los fondos de los usuarios.
  Es la consecuencia de cualquier contrato upgradeable. Lo razonable en producción sería un multisig con timelock;
  acá es una sola cuenta.
- **Orden del storage.** Una versión nueva solo puede **agregar** variables al final. No se probó una herramienta
  automática de validación de layout.
- **`ReentrancyGuard` detrás de un proxy.** Su valor inicial lo fija un constructor que solo corre en la
  implementación, así que en el proxy parte en 0. Se comprobó que el guard sigue bloqueando la reentrada
  (test «el guard de reentrancia sigue funcionando detras del proxy», con el token malicioso).
- **Dirección para la dApp.** `vestingManager` en `deployments.json` es el proxy y no cambia entre upgrades.

**Despliegue.** `contracts/script/deployUpgradeable.js` despliega implementación y proxy, y guarda ambas
direcciones. Acepta `DEPLOYMENTS_FILE` para escribir en otro archivo. Para usar la variante upgradeable con la
dApp basta con correr este script en lugar de `deploy.js`.

**Tests.** `contracts/test/VestingUpgradeable.test.js`: funcionamiento detrás del proxy, inicialización,
conservación de estado en el upgrade, autorización y cambio de dueño.

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
configurables y mint abierto. `deploy.js` lo despliega como `pUSD` y guarda su dirección en
`deployments.json` bajo la clave `mockPermitToken` (Angular la ignora).

**Tests.** `contracts/test/VestingPermit.test.js`: creación sin approve, allowance consumida y nonce avanzado, firma
vencida, de otra clave, por otro monto o repetida, firma de otro usuario, front-running del permit, fallback a una
allowance existente, token sin permit y validaciones previas.

**Estado de la dApp.** La dApp de Angular sigue usando `approve` + `createAgreement`: sumar el flujo con firma
EIP-712 desde MetaMask es trabajo de frontend que no se hizo.

## D. Deploy en L2

**Estado: preparado, no ejecutado en una testnet.** Desplegar en una L2 real requiere una cuenta con fondos de
prueba y un RPC con clave, y esos datos no están en el repo. Lo que sí se hizo y se probó en local:

- Redes configuradas en `hardhat.config.js` (`sepolia`, `baseSepolia`, `arbitrumSepolia`), con las URL tomadas de
  variables de entorno; una red solo se define si su variable existe. Se comprobó que la compilación y los 111 tests
  andan con esas variables sin definir.
- `script/measureOps.js`: ejecuta `createAgreement`, `claim` y `cancel` sobre un contrato desplegado.
- `script/compare-costs.mjs`: calcula gas y costo en ETH de cada transacción, incluido el `l1Fee` de las L2 tipo OP
  Stack.
- Gas medido en local: `createAgreement` 262.310 (el primero) y 206.210 (el segundo), `claim` 78.257 y `cancel`
  81.495.

Los pasos para correrlo en Sepolia y en una L2, y la tabla de resultados reales (todavía vacía), están en
[`DEPLOY_L2.md`](DEPLOY_L2.md). **Los costos en redes reales no se midieron.**
