// Lee uno o mas measurements/<chainId>.json (los genera script/measureOps.js) y muestra el costo de cada operacion.
// Uso: npm run compare-costs -- measurements/<chainId>.json [otro.json ...]
// No necesita dependencias. No escribe archivos.
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Uso: node script/compare-costs.mjs measurements/<chainId>.json [otro.json ...]');
  process.exit(1);
}

const toEth = (wei) => Number(wei) / 1e18;
const gwei = (wei) => Number(wei) / 1e9;

for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8'));

  console.log(`\n=== ${file}  (chainId ${run.chainId ?? '?'})`);
  console.log('operacion'.padEnd(18), 'gas usado'.padStart(11), 'gwei'.padStart(12), 'l1Fee (ETH)'.padStart(15), 'costo total (ETH)'.padStart(19));

  let totalGas = 0n;
  let totalCost = 0n;
  for (const op of run.operations ?? []) {
    const gasUsed = BigInt(op.gasUsed);
    const price = BigInt(op.effectiveGasPrice);
    // En las L2 de tipo OP Stack el recibo trae l1Fee: la tarifa por publicar los datos en L1.
    const l1Fee = BigInt(op.l1Fee ?? 0);
    const cost = gasUsed * price + l1Fee;

    totalGas += gasUsed;
    totalCost += cost;
    console.log(
      op.operacion.padEnd(18),
      gasUsed.toString().padStart(11),
      gwei(price).toFixed(6).padStart(12),
      toEth(l1Fee).toFixed(9).padStart(15),
      toEth(cost).toFixed(9).padStart(19),
    );
  }
  console.log('TOTAL'.padEnd(18), totalGas.toString().padStart(11), ''.padStart(12), ''.padStart(15), toEth(totalCost).toFixed(9).padStart(19));
}
