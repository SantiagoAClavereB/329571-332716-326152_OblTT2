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
- `src/app/wallet-check/`: pantalla de prueba de la Fase 1.

## Tests

```bash
npm test
```
