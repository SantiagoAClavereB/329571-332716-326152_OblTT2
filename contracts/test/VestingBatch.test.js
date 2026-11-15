const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");
const { Status, START_DELAY, at, warp, now } = require("./helpers");

/// Desafio opcional C: batch payroll. Varios acuerdos en una sola operacion y una sola transferencia.
describe("VestingBatch", function () {
  const MILLION = 1_000_000n * 10n ** 6n;

  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [, payer, , stranger] = signers;
    const token = await ethers.deployContract("MockToken", ["Test USD", "tUSD", 6]);
    const vesting = await ethers.deployContract("VestingManager");
    const tokenAddr = await token.getAddress();
    const vestingAddr = await vesting.getAddress();

    await token.mint(payer.address, MILLION);
    await token.connect(payer).approve(vestingAddr, ethers.MaxUint256);

    const start = (await now()) + START_DELAY;
    const end = start + 1000n;
    // Los empleados son las cuentas 4 en adelante (pueden firmar para reclamar).
    const employees = signers.slice(4, 14);
    return { vesting, token, tokenAddr, vestingAddr, payer, stranger, employees, start, end };
  }

  /// n beneficiarios con montos 100, 200, 300... tokens.
  function people(f, n) {
    return {
      addresses: f.employees.slice(0, n).map((s) => s.address),
      amounts: Array.from({ length: n }, (_, i) => BigInt(i + 1) * 100_000_000n),
    };
  }

  const batch = (f, p, { revocable = true, start = f.start, end = f.end, token = f.tokenAddr } = {}) =>
    f.vesting.connect(f.payer).createAgreementsBatch(token, p.addresses, p.amounts, start, end, revocable);

  // ------------------------------------------------------------------ camino feliz
  describe("Camino feliz", function () {
    it("crea un acuerdo por beneficiario", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, tokenAddr, payer, start, end } = f;
      const p = people(f, 3);

      const ids = await vesting
        .connect(payer)
        .createAgreementsBatch.staticCall(tokenAddr, p.addresses, p.amounts, start, end, true);
      expect(ids.map(Number)).to.deep.equal([1, 2, 3]);

      await batch(f, p);
      for (let i = 0; i < 3; i++) {
        const a = await vesting.getAgreement(i + 1);
        expect(a.payer).to.equal(payer.address);
        expect(a.beneficiary).to.equal(p.addresses[i]);
        expect(a.totalAmount).to.equal(p.amounts[i]);
        expect(a.token).to.equal(tokenAddr);
        expect(a.startTime).to.equal(start);
        expect(a.endTime).to.equal(end);
        expect(a.revocable).to.equal(true);
        expect((await vesting.getAgreementsByBeneficiary(p.addresses[i])).length).to.equal(1);
      }
      expect((await vesting.getAgreementsByPayer(payer.address)).length).to.equal(3);
    });

    it("cobra la suma en una sola transferencia", async function () {
      const f = await loadFixture(deployFixture);
      const { token, vestingAddr, payer } = f;
      const p = people(f, 4); // 100+200+300+400 = 1000
      const payerBefore = await token.balanceOf(payer.address);

      const tx = batch(f, p, { revocable: false });
      await expect(tx).to.emit(token, "Transfer").withArgs(payer.address, vestingAddr, 1_000_000_000n);

      expect(await token.balanceOf(vestingAddr)).to.equal(1_000_000_000n);
      expect(await token.balanceOf(payer.address)).to.equal(payerBefore - 1_000_000_000n);
    });

    it("emite un AgreementCreated por acuerdo", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, tokenAddr, payer, start, end } = f;
      const p = people(f, 2);

      const tx = batch(f, p);
      await expect(tx)
        .to.emit(vesting, "AgreementCreated")
        .withArgs(1, payer.address, p.addresses[0], tokenAddr, p.amounts[0], start, end, true);
      await expect(tx)
        .to.emit(vesting, "AgreementCreated")
        .withArgs(2, payer.address, p.addresses[1], tokenAddr, p.amounts[1], start, end, true);
    });

    it("cada beneficiario reclama por su cuenta", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, employees, start } = f;
      const p = people(f, 2);
      await batch(f, p);

      await at(start + 500n);
      await vesting.connect(employees[0]).claim(1);
      await at(start + 500n);
      await vesting.connect(employees[1]).claim(2);

      expect(await token.balanceOf(p.addresses[0])).to.equal(50_000_000n);
      expect(await token.balanceOf(p.addresses[1])).to.equal(100_000_000n);

      // un beneficiario no puede reclamar el acuerdo de otro
      await at(start + 500n);
      await expect(vesting.connect(employees[0]).claim(2)).to.be.revertedWithCustomError(vesting, "NotBeneficiary");
    });

    it("cada acuerdo se puede cancelar por separado", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, payer, start } = f;
      const p = people(f, 2);
      await batch(f, p);

      const payerBefore = await token.balanceOf(payer.address);
      await at(start + 500n);
      await vesting.connect(payer).cancel(2); // el segundo: 200, devengado 100, devuelve 100

      expect(await token.balanceOf(payer.address)).to.equal(payerBefore + 100_000_000n);
      expect((await vesting.getAgreement(1)).status).to.equal(Status.Active);
      expect((await vesting.getAgreement(2)).status).to.equal(Status.Cancelled);
    });

    it("permite el mismo beneficiario dos veces", async function () {
      const f = await loadFixture(deployFixture);
      const same = f.employees[0].address;
      await batch(f, { addresses: [same, same], amounts: [10_000_000n, 20_000_000n] });
      expect((await f.vesting.getAgreementsByBeneficiary(same)).length).to.equal(2);
    });
  });

  // ------------------------------------------------------------------ rechazos (el lote es atomico)
  describe("Rechazos (el lote es atomico)", function () {
    it("un lote vacio revierte", async function () {
      const f = await loadFixture(deployFixture);
      await expect(batch(f, { addresses: [], amounts: [] })).to.be.revertedWithCustomError(f.vesting, "EmptyBatch");
    });

    it("beneficiarios y montos de distinto largo revierten", async function () {
      const f = await loadFixture(deployFixture);
      const p = people(f, 3);
      await expect(batch(f, { addresses: p.addresses, amounts: [1_000_000n, 1_000_000n] })).to.be.revertedWithCustomError(
        f.vesting,
        "LengthMismatch",
      );
    });

    it("un elemento invalido revierte todo y no mueve nada", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, payer } = f;
      const p = people(f, 3);
      p.amounts[2] = 0n; // el ultimo es invalido
      const payerBefore = await token.balanceOf(payer.address);

      await expect(batch(f, p)).to.be.revertedWithCustomError(vesting, "ZeroAmount");

      expect(await token.balanceOf(payer.address)).to.equal(payerBefore);
      expect(await token.balanceOf(vestingAddr)).to.equal(0);
      expect((await vesting.getAgreementsByPayer(payer.address)).length).to.equal(0);
    });

    it("un beneficiario invalido revierte", async function () {
      const f = await loadFixture(deployFixture);
      const p = people(f, 3);

      p.addresses[1] = ethers.ZeroAddress;
      await expect(batch(f, p)).to.be.revertedWithCustomError(f.vesting, "InvalidBeneficiary");

      p.addresses[1] = f.vestingAddr;
      await expect(batch(f, p)).to.be.revertedWithCustomError(f.vesting, "InvalidBeneficiary");
    });

    it("tiempos o token invalidos revierten", async function () {
      const f = await loadFixture(deployFixture);
      const p = people(f, 2);

      await expect(batch(f, p, { start: f.end, end: f.start })).to.be.revertedWithCustomError(
        f.vesting,
        "InvalidTimeRange",
      );
      await expect(batch(f, p, { token: ethers.ZeroAddress })).to.be.revertedWithCustomError(f.vesting, "ZeroAddress");
    });

    it("revierte si la allowance cubre solo una parte de la suma", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, tokenAddr, vestingAddr, stranger, start, end } = f;
      const p = people(f, 3); // suma 600
      await token.mint(stranger.address, 600_000_000n);
      await token.connect(stranger).approve(vestingAddr, 599_000_000n);

      await expect(vesting.connect(stranger).createAgreementsBatch(tokenAddr, p.addresses, p.amounts, start, end, true))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, 599_000_000n, 600_000_000n);
    });

    it("rechaza un token que cobra comision", async function () {
      const f = await loadFixture(deployFixture);
      const feeToken = await ethers.deployContract("FeeToken");
      await feeToken.mint(f.payer.address, 1_000_000_000n);
      await feeToken.connect(f.payer).approve(f.vestingAddr, ethers.MaxUint256);

      await expect(batch(f, people(f, 2), { token: feeToken })).to.be.revertedWithCustomError(
        f.vesting,
        "FeeOnTransferNotSupported",
      );
    });
  });

  // ------------------------------------------------------------------ gas
  describe("Gas", function () {
    /// Mide el gas de crear N acuerdos uno por uno contra hacerlo en un solo lote.
    /// Se usa un snapshot para que ambos casos partan del mismo estado.
    it("el lote sale mas barato que crear los acuerdos de a uno", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, tokenAddr, payer, start, end } = f;
      const n = 10;
      const p = people(f, n);

      const snap = await takeSnapshot();
      let individualGas = 0n;
      for (let i = 0; i < n; i++) {
        const tx = await vesting
          .connect(payer)
          .createAgreement(tokenAddr, p.addresses[i], p.amounts[i], start, end, true);
        individualGas += (await tx.wait()).gasUsed;
      }
      await snap.restore();

      const batchGas = (await (await batch(f, p)).wait()).gasUsed;

      console.log("      gas de 10 createAgreement:", individualGas.toString());
      console.log("      gas de 1 createAgreementsBatch(10):", batchGas.toString());
      console.log("      ahorro (%):", Number(((individualGas - batchGas) * 100n) / individualGas));

      expect(batchGas, "el lote tiene que salir mas barato").to.be.lt(individualGas);
    });
  });
});
