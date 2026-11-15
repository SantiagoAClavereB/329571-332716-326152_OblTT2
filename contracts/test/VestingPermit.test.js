const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { Status, AMOUNT, START_DELAY, at, now, createdId } = require("./helpers");

/// Desafio opcional E: Permit (EIP-2612). El pagador crea el acuerdo en UNA transaccion, sin approve previo.
describe("VestingPermit", function () {
  const PERMIT_TYPES = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  async function deployFixture() {
    const [, owner, beneficiary, attacker, otherKey] = await ethers.getSigners();
    const token = await ethers.deployContract("MockPermitToken", ["Permit USD", "pUSD", 6]);
    const vesting = await ethers.deployContract("VestingManager");
    const tokenAddr = await token.getAddress();
    const vestingAddr = await vesting.getAddress();
    await token.mint(owner.address, 10n * AMOUNT); // tiene saldo pero NO hizo approve

    const start = (await now()) + START_DELAY;
    const end = start + 1000n;
    const deadline = (await now()) + 3600n;
    const { chainId } = await ethers.provider.getNetwork();
    const domain = { name: "Permit USD", version: "1", chainId, verifyingContract: tokenAddr };
    return { vesting, token, tokenAddr, vestingAddr, owner, beneficiary, attacker, otherKey, start, end, deadline, domain };
  }

  /// Firma un permit de `value` a favor del VestingManager con la clave de `signer`, para la cuenta `tokenOwner`.
  async function sign(f, signer, tokenOwner, value, deadline) {
    const nonce = await f.token.nonces(tokenOwner.address);
    const message = { owner: tokenOwner.address, spender: f.vestingAddr, value, nonce, deadline };
    const { v, r, s } = ethers.Signature.from(await signer.signTypedData(f.domain, PERMIT_TYPES, message));
    return { deadline, v, r, s };
  }

  const createWithPermit = (f, sig, caller, { token = f.tokenAddr, amount = AMOUNT } = {}) =>
    f.vesting
      .connect(caller)
      .createAgreementWithPermit(token, f.beneficiary.address, amount, f.start, f.end, true, sig);

  const insufficientAllowance = (f, contract = f.token) =>
    [contract, "ERC20InsufficientAllowance"];

  // ------------------------------------------------------------------ camino feliz
  describe("Camino feliz", function () {
    it("crea el acuerdo en una sola transaccion sin approve previo", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, owner, beneficiary } = f;
      expect(await token.allowance(owner.address, vestingAddr), "parte sin approve").to.equal(0);

      const id = await createdId(vesting, createWithPermit(f, await sign(f, owner, owner, AMOUNT, f.deadline), owner));

      const a = await vesting.getAgreement(id);
      expect(a.payer).to.equal(owner.address);
      expect(a.beneficiary).to.equal(beneficiary.address);
      expect(a.totalAmount).to.equal(AMOUNT);
      expect(await token.balanceOf(vestingAddr)).to.equal(AMOUNT);
      expect(await token.balanceOf(owner.address)).to.equal(9n * AMOUNT);
    });

    it("consume toda la allowance y avanza el nonce", async function () {
      const f = await loadFixture(deployFixture);
      const { token, vestingAddr, owner } = f;
      expect(await token.nonces(owner.address)).to.equal(0);
      await createWithPermit(f, await sign(f, owner, owner, AMOUNT, f.deadline), owner);

      expect(await token.allowance(owner.address, vestingAddr), "no deja una aprobacion abierta").to.equal(0);
      expect(await token.nonces(owner.address)).to.equal(1);
    });

    it("emite AgreementCreated", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, tokenAddr, owner, beneficiary, start, end } = f;
      const sig = await sign(f, owner, owner, AMOUNT, f.deadline);

      await expect(createWithPermit(f, sig, owner))
        .to.emit(vesting, "AgreementCreated")
        .withArgs(1, owner.address, beneficiary.address, tokenAddr, AMOUNT, start, end, true);
    });

    it("el acuerdo se comporta como uno normal", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, owner, beneficiary, start } = f;
      const id = await createdId(vesting, createWithPermit(f, await sign(f, owner, owner, AMOUNT, f.deadline), owner));

      await at(start + 500n);
      await vesting.connect(beneficiary).claim(id);
      expect(await token.balanceOf(beneficiary.address)).to.equal(500_000_000n);

      await at(start + 500n);
      await vesting.connect(owner).cancel(id);
      expect((await vesting.getAgreement(id)).status).to.equal(Status.Cancelled);
    });
  });

  // ------------------------------------------------------------------ firmas invalidas
  describe("Firmas invalidas", function () {
    it("un deadline vencido falla por allowance insuficiente", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, owner } = f;
      const dl = (await now()) + 10n;
      const sig = await sign(f, owner, owner, AMOUNT, dl);

      await at(dl + 1n);
      await expect(createWithPermit(f, sig, owner))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, 0, AMOUNT);
      expect(await token.balanceOf(vestingAddr)).to.equal(0);
      void vesting;
    });

    it("una firma de otra clave falla", async function () {
      const f = await loadFixture(deployFixture);
      const { token, vestingAddr, owner, otherKey } = f;
      const sig = await sign(f, otherKey, owner, AMOUNT, f.deadline);

      await expect(createWithPermit(f, sig, owner))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, 0, AMOUNT);
    });

    it("una firma por otro monto falla", async function () {
      const f = await loadFixture(deployFixture);
      const { token, vestingAddr, owner } = f;
      const sig = await sign(f, owner, owner, AMOUNT - 1n, f.deadline);

      await expect(createWithPermit(f, sig, owner))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, 0, AMOUNT);
    });

    it("una firma repetida (replay) falla", async function () {
      const f = await loadFixture(deployFixture);
      const { token, vestingAddr, owner } = f;
      const sig = await sign(f, owner, owner, AMOUNT, f.deadline);
      await createWithPermit(f, sig, owner);

      // la misma firma ya consumio su nonce y la allowance quedo en 0
      await expect(createWithPermit(f, sig, owner))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, 0, AMOUNT);
    });

    it("otra cuenta no puede usar la firma del dueno", async function () {
      const f = await loadFixture(deployFixture);
      const { token, vestingAddr, owner, attacker } = f;
      await token.mint(attacker.address, AMOUNT);
      const sig = await sign(f, owner, owner, AMOUNT, f.deadline);

      // el atacante manda la firma del dueno: permit se evalua con owner = msg.sender (el atacante) y falla
      await expect(createWithPermit(f, sig, attacker))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, 0, AMOUNT);
      expect(await token.balanceOf(owner.address), "no se toco el saldo del dueno").to.equal(10n * AMOUNT);
    });
  });

  // ------------------------------------------------------------------ front-running y fallback
  describe("Front-running y fallback", function () {
    it("ejecutar el permit antes no bloquea la creacion", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, owner, attacker } = f;
      const sig = await sign(f, owner, owner, AMOUNT, f.deadline);

      // un tercero ve la firma en el mempool y ejecuta permit antes
      await token.connect(attacker).permit(owner.address, vestingAddr, AMOUNT, sig.deadline, sig.v, sig.r, sig.s);

      // la llamada del dueno igual funciona: el permit fallido se ignora y la allowance ya existe
      const id = await createdId(vesting, createWithPermit(f, sig, owner));
      expect((await vesting.getAgreement(id)).payer).to.equal(owner.address);
      expect(await token.balanceOf(vestingAddr)).to.equal(AMOUNT);
    });

    it("usa la allowance existente si la firma no sirve", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, owner } = f;
      await token.connect(owner).approve(vestingAddr, AMOUNT);

      // firma basura: no importa, ya hay allowance
      const junk = { deadline: 0, v: 27, r: ethers.zeroPadValue("0x01", 32), s: ethers.zeroPadValue("0x02", 32) };
      const id = await createdId(vesting, createWithPermit(f, junk, owner));
      expect((await vesting.getAgreement(id)).totalAmount).to.equal(AMOUNT);
    });

    it("un token sin soporte de permit funciona con approve previo", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, vestingAddr, owner } = f;
      const plain = await ethers.deployContract("MockToken", ["Plain", "PLN", 6]);
      await plain.mint(owner.address, AMOUNT);
      await plain.connect(owner).approve(vestingAddr, AMOUNT);

      const junk = { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
      const id = await createdId(vesting, createWithPermit(f, junk, owner, { token: plain }));
      expect((await vesting.getAgreement(id)).token).to.equal(await plain.getAddress());
    });

    it("un token sin soporte de permit y sin approve revierte", async function () {
      const f = await loadFixture(deployFixture);
      const { vestingAddr, owner } = f;
      const plain = await ethers.deployContract("MockToken", ["Plain", "PLN", 6]);
      await plain.mint(owner.address, AMOUNT);

      const junk = { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
      await expect(createWithPermit(f, junk, owner, { token: plain }))
        .to.be.revertedWithCustomError(plain, "ERC20InsufficientAllowance")
        .withArgs(vestingAddr, 0, AMOUNT);
    });
  });

  // ------------------------------------------------------------------ validaciones previas
  describe("Validaciones previas", function () {
    it("las validaciones comunes corren antes de cualquier permit", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, tokenAddr, owner, beneficiary, start, end } = f;
      const sig = await sign(f, owner, owner, AMOUNT, f.deadline);
      const v = vesting.connect(owner);
      const b = beneficiary.address;

      await expect(
        v.createAgreementWithPermit(ethers.ZeroAddress, b, AMOUNT, start, end, true, sig),
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
      await expect(v.createAgreementWithPermit(tokenAddr, b, 0, start, end, true, sig)).to.be.revertedWithCustomError(
        vesting,
        "ZeroAmount",
      );
      await expect(
        v.createAgreementWithPermit(tokenAddr, ethers.ZeroAddress, AMOUNT, start, end, true, sig),
      ).to.be.revertedWithCustomError(vesting, "InvalidBeneficiary");
      await expect(
        v.createAgreementWithPermit(tokenAddr, b, AMOUNT, end, start, true, sig),
      ).to.be.revertedWithCustomError(vesting, "InvalidTimeRange");

      // como fallaron antes de llamar a permit, la firma sigue sin usarse
      expect(await token.nonces(owner.address)).to.equal(0);
    });
  });
});
