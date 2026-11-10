# Frontend (Angular 22 + Ethers.js v6)

Esta es la dApp del proyecto. Las instrucciones paso a paso para levantar Anvil, desplegar los contratos, configurar MetaMask y usar la app están en el [README de la raíz](../README.md).

## Comandos

```bash
npm install
npm start                    # http://localhost:4200
npx ng test --watch=false    # tests
npm run build                # build de producción en dist/frontend
```

Antes de `npm start` hay que tener Anvil corriendo y los contratos desplegados (pasos 3 y 4 del README de la raíz). Si no, la app avisa que falta `deployments.json`.

## Pantallas

| Ruta | Archivo | Qué hace |
|---|---|---|
| `/` | `src/app/wallet-check/` | Billetera: conecta MetaMask, muestra cuenta y red, y lee el saldo de un token |
| `/crear` | `src/app/crear/` | Formulario reactivo con validaciones, approve y creación del acuerdo |
| `/acuerdos` | `src/app/acuerdos/` | Acuerdos donde la cuenta es pagador: estado, total, devengado y cancelar |
| `/ingresos` | `src/app/ingresos/` | Acuerdos donde la cuenta es beneficiario: total, devengado, reclamado, disponible y reclamar |
| `/acuerdos/:id` | `src/app/detalle/` | Información completa, progreso temporal, estado, historial de eventos, reclamar y cancelar |

## Estructura de `src/app/core/`

- `wallet.service.ts`: conexión con MetaMask. Guarda cuenta y red en signals, y escucha `accountsChanged` y `chainChanged`.
- `networks.ts`: datos de la red Anvil, para el botón "Cambiar a Anvil".
- `vesting.service.ts`: lecturas, escrituras y eventos del contrato de vesting. También traduce al español los errores del contrato, del token y de MetaMask.
- `transaction.service.ts`: estado de cada transacción (firmando, pendiente, confirmada o fallida) y aviso a las pantallas para que recarguen los datos.
- `abis.ts`: ABIs del contrato (copia de `IVestingManager.sol`) y de ERC-20.
- `vesting.models.ts`: tipos (`Agreement`, `AgreementDetails`, `HistoryEvent`, etc.).
- `agreement-utils.ts`: estado visible, cuándo se puede cancelar o reclamar, porcentajes y formatos. Lo comparten todas las pantallas.

`src/app/shared/tx-list/` muestra los avisos con el estado de las transacciones en todas las pantallas.

## Dirección del contrato (`public/deployments.json`)

La dApp lee la dirección del contrato de vesting de `public/deployments.json`. Ese archivo lo genera `contracts/script/Deploy.s.sol` y no se sube al repo, porque las direcciones cambian con cada Anvil. El formato está indexado por chainId:

```json
{
  "31337": {
    "vestingManager": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "mockToken": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "deployBlock": 0
  }
}
```

- `vestingManager` es obligatorio.
- `deployBlock` es el bloque desde donde se buscan los eventos del historial. Es opcional y vale 0 si no está.
- `mockToken` la dApp no lo usa, porque el token se ingresa a mano en `/crear`. Sirve como referencia para saber qué dirección pegar.

Antes de usar la dirección, la dApp verifica que haya un contrato en ella. Si Anvil se reinició sin volver a desplegar, avisa que hay que correr el deploy en vez de mandar transacciones a una dirección vacía.

## Decisiones

- **Hora de la blockchain, no la de la PC:** el devengado, las validaciones de fechas y el progreso usan el `timestamp` del último bloque. Así siguen siendo correctos si se adelanta el tiempo de Anvil.
- **Decimales del token:** se leen con `decimals()`, nunca se asume 18. Los montos se convierten con `parseUnits` y `formatUnits`.
- **Approve por el monto exacto,** no ilimitado.
- **Recarga sin F5:** las pantallas recargan cuando se confirma una transacción, cada 5 segundos y al cambiar de cuenta o de red.
