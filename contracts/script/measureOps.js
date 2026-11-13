// Ejecuta las operaciones relevantes sobre un VestingManager ya desplegado, para poder comparar su costo entre
// redes (desafio opcional D): mint + approve + createAgreement + claim + createAgreement + cancel.
// Todas las transacciones las firma la misma cuenta, que es a la vez pagador y beneficiario.
//
// Variables de entorno:
//   VESTING = direccion del VestingManager       TOKEN = direccion de un MockToken (mint abierto)
//
// Uso:
//   VESTING=0x... TOKEN=0x... npx hardhat run script/measureOps.js --network <nombre>
// Deja el resultado en measurements/<chainId>.json. Despues:
//   npm run compare-costs -- measurements/<chainId>.json [otro.json ...]
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

async function main() {
  const { VESTING, TOKEN } = process.env;
  if (!VESTING || !TOKEN) throw new Error("Faltan las variables VESTING y TOKEN");

  const [me] = await ethers.getSigners();
  const vesting = await ethers.getContractAt("VestingManager", VESTING);
  const token = await ethers.getContractAt("MockToken", TOKEN);
  const { chainId } = await ethers.provider.getNetwork();

  const amount = 100n * 10n ** (await token.decimals());
  // Inicio pasado (se permite) para que ya haya algo devengado y el claim funcione de inmediato.
  const latest = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const start = latest - 100n;
  const end = latest + 86_400n;

  const operations = [];
  // El recibo crudo trae l1Fee en las L2 de tipo OP Stack (ethers no lo expone).
  async function run(name, txPromise) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    const raw = await ethers.provider.send("eth_getTransactionReceipt", [tx.hash]);
    operations.push({
      operacion: name,
      hash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.gasPrice.toString(),
      l1Fee: raw.l1Fee ? BigInt(raw.l1Fee).toString() : "0",
    });
    return receipt;
  }

  await run("mint", token.mint(me.address, 2n * amount));
  await run("approve", token.approve(VESTING, 2n * amount));

  await run("createAgreement", vesting.createAgreement(TOKEN, me.address, amount, start, end, true));
  const ids = await vesting.getAgreementsByPayer(me.address);
  const first = ids[ids.length - 1];
  await run("claim", vesting.claim(first));

  await run("createAgreement", vesting.createAgreement(TOKEN, me.address, amount, start, end, true));
  const second = (await vesting.getAgreementsByPayer(me.address)).at(-1);
  await run("cancel", vesting.cancel(second));

  console.log("acuerdo reclamado:", first.toString());
  console.log("acuerdo cancelado:", second.toString());

  const dir = path.resolve(__dirname, "../measurements");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${chainId}.json`);
  fs.writeFileSync(file, JSON.stringify({ chainId: chainId.toString(), operations }, null, 2) + "\n");
  console.log("Resultado en", file);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
