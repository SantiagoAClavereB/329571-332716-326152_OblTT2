const { ethers } = require("hardhat");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");

// Estructura de la clase 13, con Hardhat:
//   describe/it                 -> describe/it
//   loadFixture                 -> loadFixture (cada test parte de un estado limpio)
//   revertedWithCustomError     -> revertedWithCustomError
//   emit().withArgs             -> emit().withArgs
//   time.setNextBlockTimestamp  -> at(ts) para una transaccion, warp(ts) para mirar el estado en ese instante
// Para los plazos se prueba siempre: antes, exactamente en el limite y despues.

const Status = { Active: 0n, Completed: 1n, Cancelled: 2n };
const AMOUNT = 1_000n * 10n ** 6n; // 1000 tokens de 6 decimales
const DURATION = 1_000n; // segundos, para que el vesting sea 1 token por segundo
const DAY = 86_400n;
const YEAR = 365n * DAY;

/// Primeros 4 bytes del error con el que OpenZeppelin bloquea una reentrada.
const REENTRANCY_SELECTOR = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);

/// La proxima transaccion se mina exactamente en `ts`.
const at = (ts) => time.setNextBlockTimestamp(ts);

/// Mina un bloque en `ts`: las lecturas posteriores (view) ven el reloj de la cadena en ese instante.
async function warp(ts) {
  await time.setNextBlockTimestamp(ts);
  await mine();
}

/// Timestamp del ultimo bloque, como bigint (los contratos lo reciben como uint48).
async function now() {
  return BigInt(await time.latest());
}

/// Generador pseudoaleatorio con semilla: los tests "fuzz" son reproducibles.
function rng(seed) {
  let state = BigInt(seed) % 2n ** 32n;
  return function between(min, max) {
    state = (state * 1664525n + 1013904223n) % 2n ** 32n;
    return BigInt(min) + (state % (BigInt(max) - BigInt(min) + 1n));
  };
}

/// Serializa un resultado de ethers (con bigint) para compararlo por igualdad exacta.
function serialize(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

/// id del acuerdo que creo la transaccion `tx` (se lee del evento AgreementCreated).
async function createdId(vesting, tx) {
  const receipt = await (await tx).wait();
  for (const log of receipt.logs) {
    const parsed = vesting.interface.parseLog(log);
    if (parsed && parsed.name === "AgreementCreated") return parsed.args.id;
  }
  throw new Error("la transaccion no emitio AgreementCreated");
}

/// Los vesting de prueba empiezan 3000 s despues del ultimo bloque: sobra margen para que el reloj real avance
/// entre un test y otro sin que el inicio quede en el pasado.
const START_DELAY = 3_000n;

module.exports = {
  Status,
  AMOUNT,
  DURATION,
  DAY,
  YEAR,
  START_DELAY,
  REENTRANCY_SELECTOR,
  at,
  warp,
  now,
  rng,
  serialize,
  createdId,
};
