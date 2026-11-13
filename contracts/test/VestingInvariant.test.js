const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");
const { Status, DAY, YEAR, at, now, rng } = require("./helpers");

/// Invariantes: se ejecutan secuencias pseudoaleatorias (con semilla fija) de crear, reclamar, cancelar y avanzar
/// el tiempo, y despues de CADA paso se comprueba que las propiedades del contrato se siguen cumpliendo.
/// Es el equivalente en Hardhat de los invariant_* de Foundry (que traen el handler y el fuzzer incluidos).
describe("VestingInvariant", function () {
  const RUNS = 12; // secuencias distintas
  const DEPTH = 30; // pasos por secuencia

  async function deployFixture() {
    const [, ...rest] = await ethers.getSigners();
    const actors = rest.slice(0, 3);
    const token = await ethers.deployContract("MockToken", ["Test USD", "tUSD", 6]);
    const vesting = await ethers.deployContract("VestingManager");
    const vestingAddr = await vesting.getAddress();
    for (const actor of actors) {
      await token.mint(actor.address, 10n ** 30n);
      await token.connect(actor).approve(vestingAddr, ethers.MaxUint256);
    }
    return { vesting, vestingAddr, token, actors };
  }

  /// Comprueba las tres invariantes sobre todos los acuerdos creados hasta ahora.
  async function checkInvariants(f, ids) {
    if (ids.length === 0) return;
    const summaries = await f.vesting.getAgreements(ids);

    let pending = 0n;
    for (const { agreement: a, vested } of summaries) {
      // Para cada acuerdo: reclamado <= devengado <= total.
      expect(a.claimedAmount, "reclamo mas de lo devengado").to.be.lte(vested);
      expect(vested, "devengo mas que el total").to.be.lte(a.totalAmount);

      // Un acuerdo Completed tiene todo reclamado y no deja nada pendiente.
      if (a.status === Status.Completed) expect(a.claimedAmount).to.equal(a.totalAmount);

      // Active -> lo no reclamado del total, Cancelled -> lo devengado y no reclamado, Completed -> 0.
      if (a.status === Status.Active) pending += a.totalAmount - a.claimedAmount;
      else if (a.status === Status.Cancelled) pending += a.vestedAtCancel - a.claimedAmount;
    }
    // El balance del contrato siempre cubre lo que todavia se debe pagar.
    expect(await f.token.balanceOf(f.vestingAddr), "el contrato quedo sub-fondeado").to.be.gte(pending);
  }

  it("el balance cubre lo pendiente, reclamado <= devengado <= total y Completed implica todo reclamado", async function () {
    const f = await loadFixture(deployFixture);
    const { vesting, token, actors } = f;
    const tokenAddr = await token.getAddress();
    const bySigner = new Map(actors.map((a) => [a.address, a]));

    for (let run = 0; run < RUNS; run++) {
      const snap = await takeSnapshot();
      const rand = rng(1000 + run);
      const ids = [];
      let clock = (await now()) + 1_000n;

      for (let step = 0; step < DEPTH; step++) {
        const action = rand(0n, 3n);

        if (action === 0n) {
          // create
          const payer = actors[Number(rand(0n, 2n))];
          const beneficiary = actors[Number(rand(0n, 2n))];
          const amount = rand(1n, 10n ** 12n);
          const duration = rand(1n, YEAR);
          const start = clock + rand(0n, 30n * DAY);
          await at(clock);
          await vesting
            .connect(payer)
            .createAgreement(tokenAddr, beneficiary.address, amount, start, start + duration, rand(0n, 1n) === 1n);
          ids.push(BigInt(ids.length + 1));
        } else if (ids.length > 0 && (action === 1n || action === 2n)) {
          // claim (action 1) o cancel (action 2): las llamadas que revierten son parte normal de la secuencia
          const id = ids[Number(rand(0n, BigInt(ids.length - 1)))];
          const a = await vesting.getAgreement(id);
          await at(clock);
          try {
            if (action === 1n) await vesting.connect(bySigner.get(a.beneficiary)).claim(id);
            else await vesting.connect(bySigner.get(a.payer)).cancel(id);
          } catch (error) {
            // NothingToClaim, NotActive, NotRevocable, AlreadyEnded: se ignoran como en el handler de Foundry
            expect(error.message).to.match(/reverted with custom error/);
          }
        } else {
          // warp
          clock += rand(0n, 90n * DAY);
        }

        await checkInvariants(f, ids);
      }
      await snap.restore();
    }
  });
});
