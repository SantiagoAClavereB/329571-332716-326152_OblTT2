const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");
const {
  Status,
  AMOUNT,
  DURATION,
  YEAR,
  DAY,
  START_DELAY,
  REENTRANCY_SELECTOR,
  at,
  warp,
  now,
  rng,
  createdId,
} = require("./helpers");

describe("VestingManager", function () {
  async function deployFixture() {
    const [, payer, beneficiary, stranger] = await ethers.getSigners();
    const token = await ethers.deployContract("MockToken", ["Test USD", "tUSD", 6]);
    const vesting = await ethers.deployContract("VestingManager");
    const tokenAddr = await token.getAddress();
    const vestingAddr = await vesting.getAddress();

    await token.mint(payer.address, 10n * AMOUNT);
    await token.connect(payer).approve(vestingAddr, ethers.MaxUint256);

    const start = (await now()) + START_DELAY;
    const end = start + DURATION;
    return { vesting, token, tokenAddr, vestingAddr, payer, beneficiary, stranger, start, end };
  }

  /// Crea un acuerdo desde `payer` (por defecto: AMOUNT, el periodo del fixture, revocable) y devuelve su id.
  async function create(f, { amount = AMOUNT, start = f.start, end = f.end, revocable = true } = {}) {
    const tx = f.vesting
      .connect(f.payer)
      .createAgreement(f.tokenAddr, f.beneficiary.address, amount, start, end, revocable);
    return createdId(f.vesting, tx);
  }

  /// El beneficiario reclama en el segundo `ts` exacto.
  async function claimAt(f, id, ts) {
    if (ts !== undefined) await at(ts);
    return f.vesting.connect(f.beneficiary).claim(id);
  }

  /// El pagador cancela en el segundo `ts` exacto.
  async function cancelAt(f, id, ts) {
    if (ts !== undefined) await at(ts);
    return f.vesting.connect(f.payer).cancel(id);
  }

  // ============================================================ 1. Creacion
  describe("Creacion", function () {
    it("crea un acuerdo valido, bloquea los fondos y emite AgreementCreated", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, tokenAddr, vestingAddr, payer, beneficiary, start, end } = f;
      const payerBefore = await token.balanceOf(payer.address);

      await expect(
        vesting.connect(payer).createAgreement(tokenAddr, beneficiary.address, AMOUNT, start, end, true),
      )
        .to.emit(vesting, "AgreementCreated")
        .withArgs(1, payer.address, beneficiary.address, tokenAddr, AMOUNT, start, end, true);

      expect(await token.balanceOf(vestingAddr)).to.equal(AMOUNT); // el contrato bloquea el total
      expect(await token.balanceOf(payer.address)).to.equal(payerBefore - AMOUNT);

      const a = await vesting.getAgreement(1);
      expect(a.payer).to.equal(payer.address);
      expect(a.beneficiary).to.equal(beneficiary.address);
      expect(a.token).to.equal(tokenAddr);
      expect(a.totalAmount).to.equal(AMOUNT);
      expect(a.claimedAmount).to.equal(0);
      expect(a.vestedAtCancel).to.equal(0);
      expect(a.startTime).to.equal(start);
      expect(a.endTime).to.equal(end);
      expect(a.revocable).to.equal(true);
      expect(a.status).to.equal(Status.Active);
    });

    it("asigna ids unicos y los lista por pagador y por beneficiario", async function () {
      const f = await loadFixture(deployFixture);
      const id1 = await create(f, { revocable: true });
      const id2 = await create(f, { revocable: false });
      expect(id1).to.equal(1);
      expect(id2).to.equal(2);

      const byPayer = await f.vesting.getAgreementsByPayer(f.payer.address);
      const byBeneficiary = await f.vesting.getAgreementsByBeneficiary(f.beneficiary.address);
      expect(byPayer.map(Number)).to.deep.equal([1, 2]);
      expect(byBeneficiary.length).to.equal(2);
      expect((await f.vesting.getAgreementsByPayer(f.stranger.address)).length).to.equal(0);
    });

    it("permite un inicio en el pasado si el fin es futuro", async function () {
      const f = await loadFixture(deployFixture);
      const pastStart = (await now()) - 500n;
      const id = await create(f, { start: pastStart });
      expect(await f.vesting.vestedAmount(id)).to.be.gt(0); // ya devengo algo
    });

    it("revierte con parametros invalidos", async function () {
      const { vesting, tokenAddr, vestingAddr, payer, beneficiary, start, end } = await loadFixture(deployFixture);
      const v = vesting.connect(payer);
      const zero = ethers.ZeroAddress;

      await expect(v.createAgreement(zero, beneficiary.address, AMOUNT, start, end, true)).to.be.revertedWithCustomError(
        vesting,
        "ZeroAddress",
      );
      await expect(v.createAgreement(tokenAddr, zero, AMOUNT, start, end, true)).to.be.revertedWithCustomError(
        vesting,
        "InvalidBeneficiary",
      );
      await expect(v.createAgreement(tokenAddr, vestingAddr, AMOUNT, start, end, true)).to.be.revertedWithCustomError(
        vesting,
        "InvalidBeneficiary",
      );
      await expect(v.createAgreement(tokenAddr, beneficiary.address, 0, start, end, true)).to.be.revertedWithCustomError(
        vesting,
        "ZeroAmount",
      );
    });

    it("revierte con tiempos invalidos", async function () {
      const { vesting, tokenAddr, payer, beneficiary, start, end } = await loadFixture(deployFixture);
      const v = vesting.connect(payer);
      const b = beneficiary.address;

      // fin igual al inicio
      await expect(v.createAgreement(tokenAddr, b, AMOUNT, start, start, true)).to.be.revertedWithCustomError(
        vesting,
        "InvalidTimeRange",
      );
      // fin anterior al inicio
      await expect(v.createAgreement(tokenAddr, b, AMOUNT, end, start, true)).to.be.revertedWithCustomError(
        vesting,
        "InvalidTimeRange",
      );
      // fin en el pasado (aunque sea posterior al inicio)
      const pastEnd = (await now()) - 1n;
      await expect(v.createAgreement(tokenAddr, b, AMOUNT, pastEnd - 10n, pastEnd, true)).to.be.revertedWithCustomError(
        vesting,
        "InvalidTimeRange",
      );
      // fin exactamente ahora (el segundo en que se mina la transaccion)
      const t = (await now()) + 50n;
      await at(t);
      await expect(v.createAgreement(tokenAddr, b, AMOUNT, t - 200n, t, true)).to.be.revertedWithCustomError(
        vesting,
        "InvalidTimeRange",
      );
    });

    it("revierte si no hay allowance", async function () {
      const { vesting, token, tokenAddr, vestingAddr, stranger, beneficiary, start, end } =
        await loadFixture(deployFixture);
      await token.mint(stranger.address, AMOUNT); // tiene saldo pero no aprobo

      await expect(
        vesting.connect(stranger).createAgreement(tokenAddr, beneficiary.address, AMOUNT, start, end, true),
      )
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, 0, AMOUNT);
    });

    it("revierte si la allowance es menor al monto", async function () {
      const { vesting, token, tokenAddr, vestingAddr, stranger, beneficiary, start, end } =
        await loadFixture(deployFixture);
      await token.mint(stranger.address, AMOUNT);
      await token.connect(stranger).approve(vestingAddr, AMOUNT - 1n);

      await expect(
        vesting.connect(stranger).createAgreement(tokenAddr, beneficiary.address, AMOUNT, start, end, true),
      )
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, AMOUNT - 1n, AMOUNT);
    });

    it("revierte si el pagador no tiene saldo", async function () {
      const { vesting, token, tokenAddr, vestingAddr, stranger, beneficiary, start, end } =
        await loadFixture(deployFixture);
      await token.connect(stranger).approve(vestingAddr, AMOUNT);

      await expect(
        vesting.connect(stranger).createAgreement(tokenAddr, beneficiary.address, AMOUNT, start, end, true),
      )
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
        .withArgs(stranger.address, 0, AMOUNT);
    });

    it("rechaza un token que cobra comision por transferencia", async function () {
      const { vesting, vestingAddr, payer, beneficiary, start, end } = await loadFixture(deployFixture);
      const feeToken = await ethers.deployContract("FeeToken");
      await feeToken.mint(payer.address, AMOUNT);
      await feeToken.connect(payer).approve(vestingAddr, AMOUNT);

      await expect(
        vesting.connect(payer).createAgreement(feeToken, beneficiary.address, AMOUNT, start, end, true),
      ).to.be.revertedWithCustomError(vesting, "FeeOnTransferNotSupported");
    });
  });

  // ================================================================ 2. Devengado
  describe("Devengado", function () {
    it("antes del inicio es 0", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await warp(f.start - 1n);
      expect(await f.vesting.vestedAmount(id)).to.equal(0);
      expect(await f.vesting.claimableAmount(id)).to.equal(0);
    });

    it("exactamente en el inicio es 0", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await warp(f.start);
      expect(await f.vesting.vestedAmount(id)).to.equal(0);
    });

    it("durante el periodo es proporcional al tiempo", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);

      await warp(f.start + 1n);
      expect(await f.vesting.vestedAmount(id)).to.equal(AMOUNT / DURATION);
      await warp(f.start + 250n);
      expect(await f.vesting.vestedAmount(id)).to.equal(250_000_000n);
      await warp(f.start + 500n);
      expect(await f.vesting.vestedAmount(id)).to.equal(500_000_000n);
      expect(await f.vesting.claimableAmount(id)).to.equal(500_000_000n);
    });

    it("exactamente en el fin es el total", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await warp(f.end - 1n);
      expect(await f.vesting.vestedAmount(id)).to.be.lt(AMOUNT); // un segundo antes todavia no esta todo
      await warp(f.end);
      expect(await f.vesting.vestedAmount(id)).to.equal(AMOUNT);
    });

    it("despues del fin sigue en el total", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await warp(f.end + YEAR);
      expect(await f.vesting.vestedAmount(id)).to.equal(AMOUNT);
    });
  });

  // ================================================================== 3. Reclamos
  describe("Reclamos", function () {
    it("reclama una parte, emite Claimed y actualiza los saldos", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, beneficiary, start } = f;
      const id = await create(f);

      await expect(claimAt(f, id, start + 500n))
        .to.emit(vesting, "Claimed")
        .withArgs(id, beneficiary.address, 500_000_000n);

      expect(await token.balanceOf(beneficiary.address)).to.equal(500_000_000n);
      expect(await token.balanceOf(vestingAddr)).to.equal(500_000_000n);
      expect((await vesting.getAgreement(id)).claimedAmount).to.equal(500_000_000n);
      expect(await vesting.claimableAmount(id)).to.equal(0);
      expect((await vesting.getAgreement(id)).status).to.equal(Status.Active);
    });

    it("varios reclamos suman el total y el acuerdo pasa a Completed", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, beneficiary, start, end } = f;
      const id = await create(f);

      await claimAt(f, id, start + 250n);
      expect(await token.balanceOf(beneficiary.address)).to.equal(250_000_000n);
      await claimAt(f, id, start + 600n);
      expect(await token.balanceOf(beneficiary.address)).to.equal(600_000_000n);
      await claimAt(f, id, end + 1n);
      expect(await token.balanceOf(beneficiary.address)).to.equal(AMOUNT);
      expect(await token.balanceOf(vestingAddr)).to.equal(0);
      expect((await vesting.getAgreement(id)).status).to.equal(Status.Completed);
    });

    it("un segundo reclamo en el mismo instante revierte con NothingToClaim", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await claimAt(f, id, f.start + 500n);

      await expect(claimAt(f, id, f.start + 500n)).to.be.revertedWithCustomError(f.vesting, "NothingToClaim");
    });

    it("reclamar despues de haber retirado todo revierte", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await claimAt(f, id, f.end);

      await expect(claimAt(f, id, f.end + 100n)).to.be.revertedWithCustomError(f.vesting, "NothingToClaim");
    });

    it("reclamar antes del inicio revierte", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await expect(claimAt(f, id, f.start - 1n)).to.be.revertedWithCustomError(f.vesting, "NothingToClaim");
    });

    it("reclamar exactamente en el inicio revierte", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await expect(claimAt(f, id, f.start)).to.be.revertedWithCustomError(f.vesting, "NothingToClaim");
    });

    it("solo el beneficiario puede reclamar (ni el pagador ni un tercero)", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, payer, stranger, start } = f;
      const id = await create(f);
      await warp(start + 500n);

      await at(start + 500n);
      await expect(vesting.connect(stranger).claim(id)).to.be.revertedWithCustomError(vesting, "NotBeneficiary");
      await at(start + 500n);
      await expect(vesting.connect(payer).claim(id)).to.be.revertedWithCustomError(vesting, "NotBeneficiary");
    });

    it("reclamar un id inexistente revierte con AgreementNotFound", async function () {
      const f = await loadFixture(deployFixture);
      await expect(claimAt(f, 999)).to.be.revertedWithCustomError(f.vesting, "AgreementNotFound");
      await expect(claimAt(f, 0)).to.be.revertedWithCustomError(f.vesting, "AgreementNotFound");
    });
  });

  // ================================================================ 4. Cancelacion
  describe("Cancelacion", function () {
    it("cancela un acuerdo valido: congela lo devengado y devuelve el resto", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, payer, start } = f;
      const id = await create(f);
      const payerBefore = await token.balanceOf(payer.address);

      await expect(cancelAt(f, id, start + 250n))
        .to.emit(vesting, "AgreementCancelled")
        .withArgs(id, payer.address, 750_000_000n, 250_000_000n);

      const a = await vesting.getAgreement(id);
      expect(a.status).to.equal(Status.Cancelled);
      expect(a.vestedAtCancel).to.equal(250_000_000n);
      expect(await token.balanceOf(payer.address)).to.equal(payerBefore + 750_000_000n); // recupera lo no devengado
    });

    it("solo el pagador puede cancelar (ni un tercero ni el beneficiario)", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, stranger, beneficiary, start } = f;
      const id = await create(f);
      await warp(start + 250n);

      await at(start + 250n);
      await expect(vesting.connect(stranger).cancel(id)).to.be.revertedWithCustomError(vesting, "NotPayer");
      await at(start + 250n);
      await expect(vesting.connect(beneficiary).cancel(id)).to.be.revertedWithCustomError(vesting, "NotPayer");
    });

    it("un acuerdo no revocable no se puede cancelar", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f, { revocable: false });
      await expect(cancelAt(f, id, f.start + 250n)).to.be.revertedWithCustomError(f.vesting, "NotRevocable");
    });

    it("devuelve exactamente lo no devengado", async function () {
      const f = await loadFixture(deployFixture);
      const { token, vestingAddr, payer, start } = f;
      const id = await create(f);
      await cancelAt(f, id, start + 400n);

      // en el contrato queda exactamente lo devengado (400) para el beneficiario
      expect(await token.balanceOf(vestingAddr)).to.equal(400_000_000n);
      expect(await token.balanceOf(payer.address)).to.equal(10n * AMOUNT - 400_000_000n);
    });

    it("lo devengado queda congelado y el beneficiario lo puede reclamar despues", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, beneficiary, start, end } = f;
      const id = await create(f);
      await cancelAt(f, id, start + 250n);

      // el devengado queda congelado aunque pase el tiempo
      await warp(end + DAY);
      expect(await vesting.vestedAmount(id)).to.equal(250_000_000n);
      expect(await vesting.claimableAmount(id)).to.equal(250_000_000n);

      await claimAt(f, id, end + DAY);
      expect(await token.balanceOf(beneficiary.address)).to.equal(250_000_000n);
      expect(await token.balanceOf(vestingAddr)).to.equal(0);
    });

    it("despues de cancelar y reclamar no queda nada por reclamar", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await cancelAt(f, id, f.start + 250n);
      await claimAt(f, id, f.start + 250n);

      await expect(claimAt(f, id, f.start + 250n)).to.be.revertedWithCustomError(f.vesting, "NothingToClaim");
    });

    it("con un reclamo parcial previo, lo disponible es devengado menos reclamado", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, beneficiary, start } = f;
      const id = await create(f);
      await claimAt(f, id, start + 200n); // retira 200
      await cancelAt(f, id, start + 500n); // devengado 500, devuelve 500

      expect(await vesting.claimableAmount(id)).to.equal(300_000_000n); // 500 devengado - 200 ya reclamado
      await claimAt(f, id, start + 500n);
      expect(await token.balanceOf(beneficiary.address)).to.equal(500_000_000n);
      expect(await token.balanceOf(vestingAddr)).to.equal(0);
    });

    it("cancelar antes del inicio devuelve todo al pagador", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, payer, end } = f;
      const id = await create(f);
      const payerBefore = await token.balanceOf(payer.address);
      await cancelAt(f, id);

      expect(await token.balanceOf(payer.address)).to.equal(payerBefore + AMOUNT);
      expect(await token.balanceOf(vestingAddr)).to.equal(0);
      expect(await vesting.claimableAmount(id)).to.equal(0);

      await expect(claimAt(f, id, end + 1n)).to.be.revertedWithCustomError(vesting, "NothingToClaim");
    });

    it("un segundo antes del fin todavia se puede cancelar", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await cancelAt(f, id, f.end - 1n);
      expect((await f.vesting.getAgreement(id)).vestedAtCancel).to.equal(AMOUNT - AMOUNT / DURATION);
    });

    it("cancelar exactamente en el fin revierte con AlreadyEnded", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await expect(cancelAt(f, id, f.end)).to.be.revertedWithCustomError(f.vesting, "AlreadyEnded");
    });

    it("cancelar despues del fin revierte con AlreadyEnded", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await expect(cancelAt(f, id, f.end + 1n)).to.be.revertedWithCustomError(f.vesting, "AlreadyEnded");
    });

    it("cancelar dos veces revierte con NotActive", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await cancelAt(f, id, f.start + 100n);

      await expect(cancelAt(f, id, f.start + 100n)).to.be.revertedWithCustomError(f.vesting, "NotActive");
    });

    it("cancelar un acuerdo Completed revierte con NotActive", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await claimAt(f, id, f.end); // Completed

      await expect(cancelAt(f, id, f.end)).to.be.revertedWithCustomError(f.vesting, "NotActive");
    });

    it("cancelar un id inexistente revierte con AgreementNotFound", async function () {
      const f = await loadFixture(deployFixture);
      await expect(cancelAt(f, 42)).to.be.revertedWithCustomError(f.vesting, "AgreementNotFound");
    });
  });

  // =========================================================== 5. Redondeo (bordes)
  describe("Redondeo", function () {
    it("un monto chico nunca paga mas de lo depositado (redondea hacia abajo)", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, beneficiary, start } = f;
      // 7 unidades en 3 segundos: 2, 4 y 7
      const id = await create(f, { amount: 7n, end: start + 3n });

      await warp(start + 1n);
      expect(await vesting.vestedAmount(id)).to.equal(2);
      await warp(start + 2n);
      expect(await vesting.vestedAmount(id)).to.equal(4);
      await warp(start + 3n);
      expect(await vesting.vestedAmount(id)).to.equal(7);

      await claimAt(f, id, start + 3n);
      expect(await token.balanceOf(beneficiary.address)).to.equal(7);
      expect(await token.balanceOf(vestingAddr)).to.equal(0);
    });

    it("1 wei en un periodo largo no devenga nada hasta el final", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, beneficiary, start } = f;
      const id = await create(f, { amount: 1n, end: start + YEAR });

      await warp(start + YEAR - 1n);
      expect(await vesting.vestedAmount(id)).to.equal(0); // 1 wei no devenga antes del final
      await expect(claimAt(f, id, start + YEAR - 1n)).to.be.revertedWithCustomError(vesting, "NothingToClaim");

      await claimAt(f, id, start + YEAR);
      expect(await token.balanceOf(beneficiary.address)).to.equal(1);
    });

    it("cancelar nunca crea ni pierde tokens", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, payer, start } = f;
      const id = await create(f, { amount: 10n, end: start + 3n });
      const payerBefore = await token.balanceOf(payer.address);
      await cancelAt(f, id, start + 1n); // devengado = 3 (10*1/3), no devengado = 7

      expect(await token.balanceOf(payer.address)).to.equal(payerBefore + 7n);
      expect(await vesting.claimableAmount(id)).to.equal(3);
      expect(await token.balanceOf(vestingAddr)).to.equal(3);
    });

    it("un monto enorme no hace overflow", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, payer, start, end } = f;
      const big = 2n ** 128n - 1n;
      await token.mint(payer.address, big);
      const id = await create(f, { amount: big });

      await warp(start + 500n);
      expect(await vesting.vestedAmount(id)).to.equal((big * 500n) / DURATION);
      await warp(end);
      expect(await vesting.vestedAmount(id)).to.equal(big);
    });
  });

  // ================================================================ 6. Fuzzing
  // Hardhat no trae fuzzing nativo: se recorren entradas pseudoaleatorias con semilla fija (reproducibles).
  describe("Fuzzing (entradas aleatorias con semilla fija)", function () {
    it("el devengado esta acotado por el total y nunca baja", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, payer } = f;
      const rand = rng(1);

      for (let i = 0; i < 30; i++) {
        const snap = await takeSnapshot();
        const amount = rand(1n, 10n ** 24n);
        const duration = rand(1n, 5n * YEAR);
        const t1 = rand(0n, 6n * YEAR);
        const t2 = rand(t1, 6n * YEAR);

        await token.mint(payer.address, amount);
        const s = (await now()) + START_DELAY;
        const id = await create(f, { amount, start: s, end: s + duration });

        await warp(s + t1);
        const v1 = await vesting.vestedAmount(id);
        await warp(s + t2);
        const v2 = await vesting.vestedAmount(id);

        expect(v1, "nunca devenga mas que el total").to.be.lte(amount);
        expect(v1, "el devengado nunca baja").to.be.lte(v2);
        expect(v2).to.be.lte(amount);
        if (t2 >= duration) expect(v2, "al final devenga el total").to.equal(amount);
        await snap.restore();
      }
    });

    it("muchos reclamos parciales nunca superan lo depositado y al final cobra exacto", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, payer, beneficiary } = f;
      const rand = rng(2);

      for (let i = 0; i < 12; i++) {
        const snap = await takeSnapshot();
        const amount = rand(1n, 10n ** 12n);
        const duration = rand(1n, 3n * YEAR);
        const steps = rand(1n, 20n);

        await token.mint(payer.address, amount);
        const before = await token.balanceOf(beneficiary.address);
        const s = (await now()) + START_DELAY;
        const id = await create(f, { amount, start: s, end: s + duration });

        const stepLength = duration / steps + 1n;
        let ts = s;
        for (let k = 0n; k < steps; k++) {
          ts += stepLength;
          await warp(ts);
          if ((await vesting.claimableAmount(id)) > 0n) await claimAt(f, id, ts);
          expect(await token.balanceOf(beneficiary.address), "nunca cobra mas de lo depositado").to.be.lte(
            before + amount,
          );
        }

        // El reloj de la cadena no retrocede: el ultimo reclamo es en el fin o, si los pasos ya lo pasaron, en `ts`.
        const lastTs = ts > s + duration ? ts : s + duration;
        await warp(lastTs);
        if ((await vesting.claimableAmount(id)) > 0n) await claimAt(f, id, lastTs);

        expect(await token.balanceOf(beneficiary.address), "al final cobra exactamente el total").to.equal(
          before + amount,
        );
        expect(await token.balanceOf(vestingAddr), "no queda polvo en el contrato").to.equal(0);
        expect((await vesting.getAgreement(id)).status).to.equal(Status.Completed);
        await snap.restore();
      }
    });

    it("cancelar reparte exactamente el deposito entre pagador y beneficiario", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, payer } = f;
      const rand = rng(3);

      for (let i = 0; i < 30; i++) {
        const snap = await takeSnapshot();
        const amount = rand(1n, 10n ** 24n);
        const duration = rand(2n, 3n * YEAR);
        const elapsed = rand(0n, duration - 1n);

        await token.mint(payer.address, amount);
        const s = (await now()) + START_DELAY;
        const id = await create(f, { amount, start: s, end: s + duration });
        const payerBefore = await token.balanceOf(payer.address);

        await cancelAt(f, id, s + elapsed);

        const refunded = (await token.balanceOf(payer.address)) - payerBefore;
        const owed = await vesting.claimableAmount(id);
        expect(refunded + owed, "pagador + beneficiario suman exactamente el deposito").to.equal(amount);
        expect(await token.balanceOf(vestingAddr)).to.equal(owed);
        await snap.restore();
      }
    });
  });

  // ============================================================ 7. getAgreements (lote)
  describe("getAgreements (lectura en lote)", function () {
    it("devuelve los acuerdos pedidos en el orden pedido", async function () {
      const f = await loadFixture(deployFixture);
      const id1 = await create(f);
      const id2 = await create(f, { amount: 5_000_000n, revocable: false });

      const list = await f.vesting.getAgreements([id2, id1]);
      expect(list.length).to.equal(2);
      expect(list[0].agreement.totalAmount).to.equal(5_000_000n);
      expect(list[0].agreement.revocable).to.equal(false);
      expect(list[1].agreement.totalAmount).to.equal(AMOUNT);
      expect(list[1].agreement.revocable).to.equal(true);
    });

    it("incluye el devengado y lo disponible de cada acuerdo", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, start } = f;
      const id = await create(f);
      await claimAt(f, id, start + 400n); // retira 400
      await warp(start + 700n);

      const [s] = await vesting.getAgreements([id]);
      expect(s.vested).to.equal(await vesting.vestedAmount(id));
      expect(s.claimable).to.equal(await vesting.claimableAmount(id));
      expect(s.vested).to.equal(700_000_000n);
      expect(s.claimable).to.equal(300_000_000n); // 700 devengado - 400 ya reclamado
      expect(s.agreement.claimedAmount).to.equal(400_000_000n);
    });

    it("en un acuerdo cancelado usa el devengado congelado", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, start, end } = f;
      const id = await create(f);
      await cancelAt(f, id, start + 250n);
      await warp(end + DAY);

      const [s] = await vesting.getAgreements([id]);
      expect(s.vested).to.equal(250_000_000n); // congelado al cancelar
      expect(s.claimable).to.equal(250_000_000n);
    });

    it("una lista vacia devuelve una lista vacia", async function () {
      const { vesting } = await loadFixture(deployFixture);
      expect((await vesting.getAgreements([])).length).to.equal(0);
    });

    it("un id inexistente revierte con AgreementNotFound", async function () {
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await expect(f.vesting.getAgreements([id, 999])).to.be.revertedWithCustomError(f.vesting, "AgreementNotFound");
    });
  });

  // ================================================== 8. Reentrancy / token malicioso
  describe("Reentrancy", function () {
    /// Token malicioso con saldo propio y aprobacion al contrato, para que pueda actuar como pagador.
    async function evilFixture() {
      const f = await deployFixture();
      const evil = await ethers.deployContract("ReentrantToken");
      const evilAddr = await evil.getAddress();
      await evil.mint(evilAddr, 10n * AMOUNT);
      const approve = evil.interface.encodeFunctionData("approve", [f.vestingAddr, ethers.MaxUint256]);
      await evil.exec(evilAddr, approve);
      return { ...f, evil, evilAddr };
    }

    /// El token malicioso crea un acuerdo (es el pagador) con `beneficiaryAddr` como beneficiario.
    async function evilCreate(f, beneficiaryAddr) {
      const data = f.vesting.interface.encodeFunctionData("createAgreement", [
        f.evilAddr,
        beneficiaryAddr,
        AMOUNT,
        f.start,
        f.end,
        true,
      ]);
      await f.evil.exec(f.vestingAddr, data);
      const ids = await f.vesting.getAgreementsByPayer(f.evilAddr);
      return ids[ids.length - 1];
    }

    const arm = (f, fn, args) => f.evil.arm(f.vestingAddr, f.vesting.interface.encodeFunctionData(fn, args));
    const exec = (f, fn, args) => f.evil.exec(f.vestingAddr, f.vesting.interface.encodeFunctionData(fn, args));

    it("claim no se puede reentrar", async function () {
      const f = await loadFixture(evilFixture);
      // beneficiario = el token malicioso: asi la reentrada pasaria el chequeo NotBeneficiary
      const id = await evilCreate(f, f.evilAddr);

      await arm(f, "claim", [id]);
      const evilBefore = await f.evil.balanceOf(f.evilAddr);
      await at(f.start + 500n);
      await exec(f, "claim", [id]);

      expect(await f.evil.reentered(), "el token intento reentrar").to.equal(true);
      expect(await f.evil.reentrySucceeded(), "la reentrada fallo").to.equal(false);
      expect((await f.evil.reentryError()).slice(0, 10), "bloqueada por nonReentrant").to.equal(REENTRANCY_SELECTOR);
      expect((await f.evil.balanceOf(f.evilAddr)) - evilBefore, "cobro una sola vez").to.equal(500_000_000n);
      expect((await f.vesting.getAgreement(id)).claimedAmount).to.equal(500_000_000n);
    });

    it("cancel no se puede reentrar", async function () {
      const f = await loadFixture(evilFixture);
      // pagador = el token malicioso: la reentrada pasaria el chequeo NotPayer
      const id = await evilCreate(f, f.beneficiary.address);

      await arm(f, "cancel", [id]);
      const evilBefore = await f.evil.balanceOf(f.evilAddr);
      await at(f.start + 250n);
      await exec(f, "cancel", [id]);

      expect(await f.evil.reentered()).to.equal(true);
      expect(await f.evil.reentrySucceeded()).to.equal(false);
      expect((await f.evil.reentryError()).slice(0, 10)).to.equal(REENTRANCY_SELECTOR);
      expect((await f.evil.balanceOf(f.evilAddr)) - evilBefore, "recibio el reembolso una sola vez").to.equal(
        750_000_000n,
      );
      expect((await f.vesting.getAgreement(id)).status).to.equal(Status.Cancelled);
    });

    it("cancel no puede reentrar a claim", async function () {
      const f = await loadFixture(evilFixture);
      // pagador y beneficiario son el token malicioso: durante el reembolso intenta reclamar
      const id = await evilCreate(f, f.evilAddr);

      await arm(f, "claim", [id]);
      await at(f.start + 250n);
      await exec(f, "cancel", [id]);

      expect(await f.evil.reentered()).to.equal(true);
      expect(await f.evil.reentrySucceeded()).to.equal(false);
      expect((await f.evil.reentryError()).slice(0, 10)).to.equal(REENTRANCY_SELECTOR);
      expect((await f.vesting.getAgreement(id)).claimedAmount, "no logro reclamar durante el reembolso").to.equal(0);
    });

    it("createAgreement no se puede reentrar", async function () {
      const f = await loadFixture(evilFixture);
      const args = [f.evilAddr, f.beneficiary.address, AMOUNT, f.start, f.end, true];
      await arm(f, "createAgreement", args);

      await exec(f, "createAgreement", args);

      expect(await f.evil.reentered()).to.equal(true);
      expect(await f.evil.reentrySucceeded()).to.equal(false);
      expect((await f.evil.reentryError()).slice(0, 10)).to.equal(REENTRANCY_SELECTOR);
      expect((await f.vesting.getAgreementsByBeneficiary(f.beneficiary.address)).length, "un solo acuerdo").to.equal(1);
    });

    it("el estado se actualiza antes de transferir (checks-effects-interactions)", async function () {
      // Con un token honesto: tras reclamar, claimedAmount ya refleja el pago.
      const f = await loadFixture(deployFixture);
      const id = await create(f);
      await claimAt(f, id, f.start + 500n);
      expect((await f.vesting.getAgreement(id)).claimedAmount).to.equal(await f.token.balanceOf(f.beneficiary.address));
    });
  });
});
