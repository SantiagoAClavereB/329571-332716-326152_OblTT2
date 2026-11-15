const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");
const { Status, AMOUNT, START_DELAY, at, warp, now, rng, createdId } = require("./helpers");

/// Desafio opcional A: cliff. Antes del cliff no se puede reclamar nada; desde el cliff se respeta el
/// vesting lineal calculado desde startTime.
describe("VestingCliff", function () {
  async function deployFixture() {
    const [, payer, beneficiary] = await ethers.getSigners();
    const token = await ethers.deployContract("MockToken", ["Test USD", "tUSD", 6]);
    const vesting = await ethers.deployContract("VestingManager");
    const tokenAddr = await token.getAddress();

    await token.mint(payer.address, 10n * AMOUNT);
    await token.connect(payer).approve(await vesting.getAddress(), ethers.MaxUint256);

    const start = (await now()) + START_DELAY;
    const cliff = start + 300n;
    const end = start + 1000n;
    return { vesting, token, tokenAddr, payer, beneficiary, start, cliff, end };
  }

  const createWithCliff = (f, cliff = f.cliff, { revocable = true, end = f.end, amount = AMOUNT } = {}) =>
    f.vesting
      .connect(f.payer)
      .createAgreementWithCliff(f.tokenAddr, f.beneficiary.address, amount, f.start, cliff, end, revocable);

  const createdWithCliff = (f, revocable = true) => createdId(f.vesting, createWithCliff(f, f.cliff, { revocable }));

  async function claimAt(f, id, ts) {
    await at(ts);
    return f.vesting.connect(f.beneficiary).claim(id);
  }

  // ------------------------------------------------------------------ creacion
  describe("Creacion", function () {
    it("guarda el cliff y emite AgreementCreated y CliffConfigured", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, tokenAddr, payer, beneficiary, start, cliff, end } = f;

      const tx = createWithCliff(f);
      await expect(tx)
        .to.emit(vesting, "AgreementCreated")
        .withArgs(1, payer.address, beneficiary.address, tokenAddr, AMOUNT, start, end, true);
      await expect(tx).to.emit(vesting, "CliffConfigured").withArgs(1, cliff);

      expect(await vesting.cliffOf(1)).to.equal(cliff);
      expect(await token.balanceOf(await vesting.getAddress())).to.equal(AMOUNT);
    });

    it("un acuerdo sin cliff informa cliff 0", async function () {
      const f = await loadFixture(deployFixture);
      const tx = f.vesting
        .connect(f.payer)
        .createAgreement(f.tokenAddr, f.beneficiary.address, AMOUNT, f.start, f.end, true);
      const id = await createdId(f.vesting, tx);
      expect(await f.vesting.cliffOf(id)).to.equal(0);
    });

    it("cliffOf de un id inexistente revierte", async function () {
      const { vesting } = await loadFixture(deployFixture);
      await expect(vesting.cliffOf(77)).to.be.revertedWithCustomError(vesting, "AgreementNotFound");
    });

    it("revierte si el cliff es anterior al inicio", async function () {
      const f = await loadFixture(deployFixture);
      await expect(createWithCliff(f, f.start - 1n)).to.be.revertedWithCustomError(f.vesting, "InvalidCliff");
    });

    it("revierte si el cliff es posterior al fin", async function () {
      const f = await loadFixture(deployFixture);
      await expect(createWithCliff(f, f.end + 1n)).to.be.revertedWithCustomError(f.vesting, "InvalidCliff");
    });

    it("rechaza el cliff 0 (para eso esta createAgreement)", async function () {
      const f = await loadFixture(deployFixture);
      await expect(createWithCliff(f, 0n)).to.be.revertedWithCustomError(f.vesting, "InvalidCliff");
    });

    it("mantiene las validaciones comunes", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, tokenAddr, payer, beneficiary, start, cliff, end } = f;
      const v = vesting.connect(payer);

      await expect(
        v.createAgreementWithCliff(tokenAddr, beneficiary.address, 0, start, cliff, end, true),
      ).to.be.revertedWithCustomError(vesting, "ZeroAmount");
      await expect(
        v.createAgreementWithCliff(tokenAddr, ethers.ZeroAddress, AMOUNT, start, cliff, end, true),
      ).to.be.revertedWithCustomError(vesting, "InvalidBeneficiary");
      await expect(
        v.createAgreementWithCliff(tokenAddr, beneficiary.address, AMOUNT, start, cliff, start, true),
      ).to.be.revertedWithCustomError(vesting, "InvalidTimeRange");
    });

    it("permite un cliff igual al inicio o igual al fin", async function () {
      const f = await loadFixture(deployFixture);
      const a = await createdId(f.vesting, createWithCliff(f, f.start));
      const b = await createdId(f.vesting, createWithCliff(f, f.end));
      expect(await f.vesting.cliffOf(a)).to.equal(f.start);
      expect(await f.vesting.cliffOf(b)).to.equal(f.end);
    });
  });

  // ------------------------------------------------------------------ devengado
  describe("Devengado", function () {
    it("no devenga nada antes del cliff", async function () {
      const f = await loadFixture(deployFixture);
      const id = await createdWithCliff(f);

      await warp(f.cliff - 1n);
      expect(await f.vesting.vestedAmount(id), "un segundo antes del cliff").to.equal(0);
      expect(await f.vesting.claimableAmount(id)).to.equal(0);

      await expect(claimAt(f, id, f.cliff - 1n)).to.be.revertedWithCustomError(f.vesting, "NothingToClaim");
    });

    it("exactamente en el cliff devenga lo lineal desde el inicio", async function () {
      const f = await loadFixture(deployFixture);
      const id = await createdWithCliff(f);
      await warp(f.cliff);
      // 300 s de 1000 s desde el inicio -> 300 tokens, no 0
      expect(await f.vesting.vestedAmount(id)).to.equal(300_000_000n);

      await claimAt(f, id, f.cliff);
      expect(await f.token.balanceOf(f.beneficiary.address)).to.equal(300_000_000n);
    });

    it("despues del cliff sigue el esquema lineal y termina en el total", async function () {
      const f = await loadFixture(deployFixture);
      const id = await createdWithCliff(f);

      await warp(f.start + 600n);
      expect(await f.vesting.vestedAmount(id)).to.equal(600_000_000n);

      await warp(f.end);
      expect(await f.vesting.vestedAmount(id)).to.equal(AMOUNT);
      await claimAt(f, id, f.end);
      expect(await f.token.balanceOf(f.beneficiary.address)).to.equal(AMOUNT);
      expect((await f.vesting.getAgreement(id)).status).to.equal(Status.Completed);
    });

    it("con el cliff en el fin es todo o nada", async function () {
      const f = await loadFixture(deployFixture);
      const id = await createdId(f.vesting, createWithCliff(f, f.end));

      await warp(f.end - 1n);
      expect(await f.vesting.vestedAmount(id)).to.equal(0);
      await warp(f.end);
      expect(await f.vesting.vestedAmount(id)).to.equal(AMOUNT);
    });

    it("getAgreements muestra 0 antes del cliff", async function () {
      const f = await loadFixture(deployFixture);
      const id = await createdWithCliff(f);
      await warp(f.start + 100n);

      const [s] = await f.vesting.getAgreements([id]);
      expect(s.vested).to.equal(0);
      expect(s.claimable).to.equal(0);
    });
  });

  // ------------------------------------------------------------------ cancelacion
  describe("Cancelacion", function () {
    it("cancelar antes del cliff devuelve todo al pagador", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, payer, start, end } = f;
      const id = await createdWithCliff(f);
      const payerBefore = await token.balanceOf(payer.address);

      await at(start + 200n); // antes del cliff, aunque ya paso el inicio
      await vesting.connect(payer).cancel(id);

      expect(await token.balanceOf(payer.address), "el beneficiario no habia llegado al cliff").to.equal(
        payerBefore + AMOUNT,
      );
      expect((await vesting.getAgreement(id)).vestedAtCancel).to.equal(0);

      await expect(claimAt(f, id, end + 1n)).to.be.revertedWithCustomError(vesting, "NothingToClaim");
    });

    it("cancelar despues del cliff deja lo devengado para el beneficiario", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, payer, beneficiary, start } = f;
      const id = await createdWithCliff(f);
      const payerBefore = await token.balanceOf(payer.address);

      await at(start + 500n);
      await vesting.connect(payer).cancel(id);

      expect(await token.balanceOf(payer.address)).to.equal(payerBefore + 500_000_000n);
      expect(await vesting.claimableAmount(id)).to.equal(500_000_000n);
      await claimAt(f, id, start + 500n);
      expect(await token.balanceOf(beneficiary.address)).to.equal(500_000_000n);
      expect(await token.balanceOf(await vesting.getAddress())).to.equal(0);
    });
  });

  // ------------------------------------------------------------------ fuzzing
  describe("Fuzzing (entradas aleatorias con semilla fija)", function () {
    it("nunca devenga antes del cliff ni mas que el total", async function () {
      const f = await loadFixture(deployFixture);
      const rand = rng(11);

      for (let i = 0; i < 25; i++) {
        const snap = await takeSnapshot();
        const cliffOffset = rand(0n, 1000n);
        const elapsed = rand(0n, 2000n);

        const id = await createdId(f.vesting, createWithCliff(f, f.start + cliffOffset));
        await warp(f.start + elapsed);
        const vested = await f.vesting.vestedAmount(id);

        if (elapsed < cliffOffset) expect(vested, "nada antes del cliff").to.equal(0);
        expect(vested, "nunca mas que el total").to.be.lte(AMOUNT);
        if (elapsed >= 1000n) expect(vested).to.equal(AMOUNT);
        await snap.restore();
      }
    });
  });
});
