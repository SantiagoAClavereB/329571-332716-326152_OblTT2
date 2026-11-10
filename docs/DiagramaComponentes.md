# Diagrama de componentes

```mermaid
flowchart TB
  subgraph DAPP["dApp — Angular 22 + Ethers.js v6 (navegador)"]
    direction TB
    subgraph UI["Pantallas"]
      direction LR
      CREAR["/crear<br/>approve + crear acuerdo"]
      ACU["/acuerdos<br/>como pagador · cancelar"]
      ING["/ingresos<br/>como beneficiario · reclamar"]
      DET["/acuerdos/:id<br/>detalle + historial"]
      BIL["/ Billetera<br/>cuenta, red y saldo"]
      TXL["TxList<br/>avisos de transacciones"]
    end
    subgraph CORE["Servicios — core/"]
      direction LR
      TS["TransactionService<br/>firmando · pendiente ·<br/>confirmada · fallida"]
      VS["VestingService<br/>lecturas, escrituras,<br/>eventos y errores"]
      WS["WalletService<br/>cuenta y red en signals"]
      TS --> VS --> WS
    end
    DJ[("public/deployments.json")]
    UI -- "usan" --> CORE
    VS -- "dirección del contrato" --> DJ
  end

  MM["MetaMask<br/>guarda las claves y firma"]

  subgraph CHAIN["Anvil — red local EVM, chainId 31337"]
    direction LR
    VM["VestingManager<br/>acuerdos + fondos bloqueados"]
    TK["Token ERC-20<br/>MockToken 6 dec. u otro"]
    VM -- "transferFrom al crear<br/>transfer al reclamar / cancelar<br/>con SafeERC20" --> TK
  end

  subgraph FOUNDRY["Foundry"]
    direction LR
    DEP["script/Deploy.s.sol"]
    TST["Tests: unitarios, fuzzing,<br/>invariantes, reentrancy<br/>EVM en memoria de forge"]
  end

  WS <-- "EIP-1193<br/>cuenta, red y eventos" --> MM
  MM -- "escrituras firmadas<br/>approve · createAgreement · claim · cancel" --> CHAIN
  VS -- "lecturas sin firma, JSON-RPC<br/>getAgreements · listados · saldos · eventos" --> CHAIN
  DEP -- "despliega" --> CHAIN
  DEP -- "escribe direcciones" --> DJ
```

## Componentes

| Componente | Responsabilidad |
|---|---|
| **VestingManager** | Un solo contrato para todos los acuerdos (`mapping(id => Agreement)`). Recibe y bloquea los fondos, calcula lo devengado y ejecuta reclamos y cancelaciones. Emite `AgreementCreated`, `Claimed` y `AgreementCancelled` |
| **Token ERC-20** | Medio de pago. En local es `MockToken` (6 decimales, `mint` abierto), pero el contrato acepta cualquier ERC-20 sin comisión por transferencia |
| **Deploy.s.sol** | Despliega el token y el VestingManager, y deja las direcciones en `frontend/public/deployments.json` |
| **Tests** | Corren en la EVM en memoria de forge, no en Anvil. Manejan el tiempo con `vm.warp` y usan tokens maliciosos (`ReentrantToken`, `FeeToken`) |
| **MetaMask** | Guarda las claves y firma. La dApp nunca ve una private key |
| **WalletService** | Conecta la billetera, guarda la cuenta y la red en signals, y escucha `accountsChanged` y `chainChanged` |
| **VestingService** | Única pieza que habla con los contratos: lecturas, escrituras, historial a partir de eventos y traducción de errores al español. Usa el provider y el signer de `WalletService` |
| **TransactionService** | Sigue cada transacción hasta que se confirma o falla, y avisa a las pantallas para que recarguen. Usa `VestingService` para traducir los errores |
| **Pantallas** | `/crear`, `/acuerdos`, `/ingresos` y `/acuerdos/:id` usan los tres servicios. La Billetera usa solo `WalletService`, y `TxList` solo `TransactionService` |
| **deployments.json** | Une el deploy con la dApp: la dirección del contrato no está escrita en el código |

## Cómo leer las flechas

- **Lecturas:** van directo de la dApp al nodo, sin firma ni gas. Incluyen `getAgreements`, los listados, los saldos del token y los eventos (`queryFilter`) que arman el historial.
- **Escrituras:** pasan por MetaMask, que las firma y las envía. Son `approve` sobre el token, y `createAgreement`, `claim` y `cancel` sobre el VestingManager.
- **VestingManager → Token:** el único lugar donde se mueven fondos, siempre con SafeERC20.
- **Servicios:** las flechas internas indican dependencia. `TransactionService` usa `VestingService`, que usa `WalletService`.
