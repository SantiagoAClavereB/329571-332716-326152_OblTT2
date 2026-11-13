# Vesting dApp — Obligatorio Taller de Tecnologías 2

dApp para crear acuerdos de pago salarial o vesting con un token ERC-20.

1. El pagador deposita el monto total al crear el acuerdo.
2. El beneficiario reclama la parte devengada, que crece en forma lineal entre la fecha de inicio y la de fin.
3. Si el acuerdo es revocable, el pagador puede cancelarlo. En ese caso recupera lo no devengado, y lo devengado sigue siendo del beneficiario.

| Carpeta | Contenido |
|---|---|
| `contracts/` | Smart contracts, tests y scripts de deploy (Hardhat) |
| `frontend/` | dApp en Angular 22 + Ethers.js v6 |
| `docs/` | Letra del obligatorio y decisiones de diseño |

## 1. Requisitos

| Herramienta | Versión probada | Instalación |
|---|---|---|
| Git | cualquiera reciente | https://git-scm.com |
| Node.js | 22.22+, 24.15+ o 26+ (lo exige Angular 22) | https://nodejs.org |
| npm | 11 (viene con Node) | — |
| MetaMask | extensión del navegador | https://metamask.io |

Hardhat y OpenZeppelin no se instalan aparte: vienen en las dependencias de `contracts/` (paso 2).

Para comprobar que estén instalados:

```bash
git --version
node -v
npm -v
```

## 2. Instalar dependencias

```bash
git clone https://github.com/SantiagoAClavereB/329571-332716-326152_OblTT2.git
cd 329571-332716-326152_OblTT2
cd contracts
npm install
npm run compile
cd ../frontend
npm install
cd ..
```

## 3. Levantar la blockchain local

En una terminal aparte, que queda abierta:

```bash
cd contracts
npm run node
```

- RPC: `http://127.0.0.1:8545`
- chainId: `31337`
- Imprime 20 cuentas con 10.000 ETH cada una, junto con sus private keys. Son las cuentas públicas de prueba de Hardhat y no sirven en redes reales.

`npm run node` mina un bloque por segundo. Si no hubiera bloques nuevos, `block.timestamp` no avanzaría mientras no haya transacciones, y el devengado parecería quedarse quieto.

## 4. Desplegar los contratos

En otra terminal:

```bash
cd contracts
npm run deploy:local
```

El script `script/deploy.js` hace lo siguiente:

1. Despliega `MockToken`, un token de prueba "Test USD" (`tUSD`) con **6 decimales**.
2. Despliega `MockPermitToken` ("Permit USD", `pUSD`), igual pero con soporte de Permit (EIP-2612), para probar el desafío E.
3. Despliega `VestingManager`.
4. Le da 1.000.000 de cada token a la cuenta #0, que es la que despliega.
5. Escribe las direcciones en `frontend/public/deployments.json`, de donde las lee la dApp.

En un nodo recién iniciado las direcciones siempre son las mismas:

| Contrato | Dirección |
|---|---|
| MockToken (tUSD) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| MockPermitToken (pUSD) | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| VestingManager | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

> **Si se reinicia el nodo**, la blockchain arranca vacía. Hay que volver a correr el deploy. En MetaMask también conviene hacer *Configuración → Avanzado → Borrar datos de actividad*, para que no queden nonces viejos.

## 5. Configurar MetaMask

1. Importar cuentas de la red local: *Cuentas → Agregar cuenta → Importar cuenta* y pegar la private key que imprime `npm run node`. Para probar los tres roles alcanza con estas:

   | Cuenta local | Dirección | Rol sugerido |
   |---|---|---|
   | #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | Pagador (tiene los tUSD) |
   | #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | Beneficiario |
   | #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | Tercero sin permisos |

2. La red local (chainId 31337) no hace falta agregarla a mano. La dApp ofrece el botón **Cambiar a Anvil**, que la agrega si MetaMask no la conoce. El nombre del botón quedó de una versión anterior: la red es la misma, la que levanta `npm run node`.
3. Opcional: para ver el saldo de tUSD en MetaMask, usar *Importar tokens* con la dirección del MockToken.

## 6. Ejecutar la dApp

```bash
cd frontend
npm start
```

Abrir http://localhost:4200 y apretar **Conectar MetaMask**. Si MetaMask está en otra red, apretar **Cambiar a Anvil**.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Crear | `/crear` | Formulario del acuerdo: token, beneficiario, monto, inicio, fin y revocable. Hace el approve y la creación |
| Mis acuerdos | `/acuerdos` | Acuerdos donde la cuenta es pagador: estado, total, devengado y cancelar |
| Mis ingresos | `/ingresos` | Acuerdos donde la cuenta es beneficiario: total, devengado, reclamado, disponible y reclamar |
| Detalle | `/acuerdos/:id` | Información completa, progreso temporal, estado e historial de eventos |

En el campo **Token** de `/crear` va la dirección del MockToken. También se puede usar cualquier otro ERC-20 desplegado en la red local: la dApp lee sus decimales del contrato.

### Comandos útiles durante la demo

Con el nodo (`npm run node`) corriendo.

**Darle tokens a otra cuenta.** El `mint` del token de prueba es abierto. Este ejemplo le da 1.000 tUSD (6 decimales) a la cuenta #1, desde la consola de Hardhat:

```bash
cd contracts
npx hardhat console --network localhost
```

```js
const token = await ethers.getContractAt("MockToken", "0x5FbDB2315678afecb367f032d93F642f64180aa3");
await token.mint("0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 1000000000n);
```

**Adelantar el tiempo de la blockchain.** Este ejemplo adelanta 1 día (86.400 segundos):

```bash
curl -s -X POST -H "content-type: application/json" --data '{"jsonrpc":"2.0","method":"evm_increaseTime","params":[86400],"id":1}' http://127.0.0.1:8545
curl -s -X POST -H "content-type: application/json" --data '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}' http://127.0.0.1:8545
```

La dApp usa la hora de la blockchain, no la de la PC. Después de adelantar el tiempo, el devengado y las validaciones de fechas se ajustan solos.

## 7. Tests de los contratos

```bash
cd contracts
npm test
```

Hay 111 tests:

- **Unitarios:** creación, devengado, reclamos, cancelación, redondeo y lectura en lote.
- **Entradas aleatorias con semilla fija:** redondeo, reclamos parciales y reparto en la cancelación.
- **Reentrancy:** con un token malicioso.
- **Invariantes:** secuencias aleatorias de crear, reclamar, cancelar y avanzar el tiempo; en cada paso el balance del contrato cubre lo pendiente.
- **Desafíos opcionales:** cliff, batch payroll, Permit (EIP-2612) y la variante upgradeable (UUPS). Ver [`docs/DESAFIOS_OPCIONALES.md`](docs/DESAFIOS_OPCIONALES.md).

Todos manipulan el tiempo con `time.setNextBlockTimestamp` (de `hardhat-network-helpers`), así que no dependen de la hora real. Corren en la red en memoria de Hardhat, no hace falta el nodo del paso 3.

## 8. Coverage

```bash
cd contracts
npm run coverage
```

Corre los tests y muestra la tabla de cobertura por archivo. La letra pide al menos 75% de líneas; `VestingManager.sol` tiene 100%. El reporte HTML queda en `contracts/coverage/index.html`.

## 9. Tests del frontend

```bash
cd frontend
npx ng test --watch=false
```

Prueban el `TransactionService` y las funciones de `agreement-utils.ts`.

## 10. Documentación

- [`docs/Obligatorio_2026_Blockchain.md`](docs/Obligatorio_2026_Blockchain.md): la letra.
- [`docs/DOCUMENTO_ARQUITECTURA.md`](docs/DOCUMENTO_ARQUITECTURA.md) (PDF: `docs/Documento_de_Arquitectura.pdf`): documento de arquitectura completo, con diagramas, decisiones y comparación L1 vs L2.
- [`docs/DECLARACION_IA.md`](docs/DECLARACION_IA.md) (PDF: `docs/Declaracion_de_IA.pdf`): declaración de uso de IA.
- [`docs/DECISIONES_DEFENSA.md`](docs/DECISIONES_DEFENSA.md): arquitectura, storage/memory/calldata, fórmula de vesting, máquina de estados, cancelación, seguridad y ERC-20.
- [`docs/DESAFIOS_OPCIONALES.md`](docs/DESAFIOS_OPCIONALES.md) y [`docs/DEPLOY_L2.md`](docs/DEPLOY_L2.md): desafíos opcionales y cómo desplegar en una L2.
- [`frontend/Readme.md`](frontend/Readme.md): estructura del frontend y formato de `deployments.json`.

## Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| "No se encontró deployments.json: hay que correr el script de deploy." | Todavía no se corrió el deploy. Correr el paso 4 |
| "No hay contrato de vesting en la dirección de deployments.json: volvé a correr el deploy." | Se reinició el nodo y `deployments.json` quedó con direcciones viejas. Correr el paso 4 |
| MetaMask da error de nonce o la transacción queda colgada | Se reinició el nodo. En MetaMask: *Configuración → Avanzado → Borrar datos de actividad* |
| El devengado no avanza | El nodo no se levantó con `npm run node` (que mina un bloque por segundo). Por ejemplo, si se usó `npx hardhat node` a mano |
| "Estás en otra red" | MetaMask no está en la red local (chainId 31337). Apretar **Cambiar a Anvil** |
| `npm test` no encuentra `@openzeppelin/...` | Faltan las dependencias de `contracts/`. Correr `npm install` ahí (paso 2) |
