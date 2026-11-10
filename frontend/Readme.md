# Frontend (Angular + Ethers.js)

## Ejecutar

```bash
npm install
npm start          # http://localhost:4200
```

## Prueba de billetera (Fase 1)

La pantalla inicial conecta MetaMask, muestra cuenta y red, y lee el balance de un token ERC-20.

1. Levantar Anvil: `anvil --block-time 1` (RPC `http://127.0.0.1:8545`, chainId `31337`).
2. En MetaMask, importar una cuenta de Anvil con una de las private keys que imprime `anvil`
   (la cuenta #0 es la que despliega).
3. Desplegar un token en Anvil y copiar la dirección (`Deployed to: 0x…`).
4. `npm start`, abrir `http://localhost:4200`, **Conectar MetaMask** y, si hace falta, **Cambiar a Anvil**
   (agrega la red a MetaMask si no existe).
5. Pegar la dirección del token y apretar **Leer balance**.

Si se reinicia Anvil, en MetaMask conviene hacer *Configuración → Avanzado → Borrar datos de actividad*
para que no queden nonces viejos.

## Estructura

- `src/app/core/wallet.service.ts`: conexión con MetaMask. Guarda cuenta y red en signals y escucha `accountsChanged` / `chainChanged`.
- `src/app/core/networks.ts`: datos de la red Anvil.
- `src/app/core/vesting.service.ts`: lecturas, escrituras y eventos del contrato de vesting.
- `src/app/core/transaction.service.ts`: estado de cada transacción (firmando, pendiente, confirmada, fallida) y aviso para recargar datos.
- `src/app/core/abis.ts`: ABIs del contrato (copia de `IVestingManager.sol`) y de ERC-20.
- `src/app/core/vesting.models.ts`: tipos (`Agreement`, `AgreementDetails`, `HistoryEvent`…).
- `src/app/shared/tx-list/`: avisos con el estado de las transacciones (se muestran en todas las pantallas).
- `src/app/crear/`: pantalla `/crear` (formulario reactivo con validaciones, approve + creación).
- `src/app/acuerdos/`: pantalla `/acuerdos` (acuerdos donde la cuenta es pagador: estado, total, devengado y cancelar).
- `src/app/detalle/`: pantalla `/acuerdos/:id` (información completa, progreso temporal, estado, historial de eventos, reclamar y cancelar).
- `src/app/ingresos/`: pantalla `/ingresos` (acuerdos donde la cuenta es beneficiario: total, devengado, reclamado, disponible y reclamar).
- `src/app/core/agreement-utils.ts`: estado visible, cuándo se puede cancelar, porcentajes y formatos (compartido entre pantallas).
- `src/app/wallet-check/`: pantalla de prueba de la Fase 1.

## Dirección del contrato (`public/deployments.json`)

La dApp lee la dirección del contrato de vesting de `public/deployments.json`, que tiene que generar el
script de deploy. Formato (indexado por chainId):

```json
{ "31337": { "vestingManager": "0x…", "deployBlock": 0 } }
```

`deployBlock` es opcional: es el bloque desde donde se buscan los eventos para el historial.

## Tests

```bash
npm test
```
