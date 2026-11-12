// Lee uno o mas broadcast/MeasureOps.s.sol/<chainId>/run-latest.json y muestra el costo de cada transaccion.
// Uso: node script/compare-costs.mjs <run-latest.json> [otro run-latest.json ...]
// No necesita dependencias. No escribe archivos.
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Uso: node script/compare-costs.mjs <run-latest.json> [otro run-latest.json ...]');
  process.exit(1);
}

const big = (hex) => (hex ? BigInt(hex) : 0n);
const toEth = (wei) => Number(wei) / 1e18;
const gwei = (wei) => Number(wei) / 1e9;

for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const receipts = new Map((run.receipts ?? []).map((r) => [r.transactionHash.toLowerCase(), r]));

  console.log(`\n=== ${file}  (chainId ${run.chain ?? '?'})`);
  console.log('operacion'.padEnd(18), 'gas usado'.padStart(11), 'gwei'.padStart(12), 'l1Fee (ETH)'.padStart(15), 'costo total (ETH)'.padStart(19));

  let totalGas = 0n;
  let totalCost = 0n;
  for (const tx of run.transactions ?? []) {
    const receipt = receipts.get(String(tx.hash).toLowerCase());
    if (!receipt) continue;

    const name = (tx.function ?? tx.contractName ?? tx.transactionType ?? '?').split('(')[0];
    const gasUsed = big(receipt.gasUsed);
    const price = big(receipt.effectiveGasPrice);
    // En las L2 de tipo OP Stack el recibo trae l1Fee: la tarifa por publicar los datos en L1.
    const l1Fee = big(receipt.l1Fee);
    const cost = gasUsed * price + l1Fee;

    totalGas += gasUsed;
    totalCost += cost;
    console.log(
      name.padEnd(18),
      gasUsed.toString().padStart(11),
      gwei(price).toFixed(6).padStart(12),
      toEth(l1Fee).toFixed(9).padStart(15),
      toEth(cost).toFixed(9).padStart(19),
    );
  }
  console.log('TOTAL'.padEnd(18), totalGas.toString().padStart(11), ''.padStart(12), ''.padStart(15), toEth(totalCost).toFixed(9).padStart(19));
}
