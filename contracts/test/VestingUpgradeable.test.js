const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { Status, AMOUNT, START_DELAY, REENTRANCY_SELECTOR, at, warp, now, serialize, createdId } = require("./helpers");

/// Desafio opcional B: upgradeabilidad UUPS. Un upgrade tiene que conservar todos los acuerdos existentes.
describe("VestingUpgradeable", function () {
  const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

  async function deployFixture() {
    const [, owner, payer, beneficiary, stranger] = await ethers.getSigners();
    const token = await ethers.deployContract("MockToken", ["Test USD", "tUSD", 6]);
    const tokenAddr = await token.getAddress();

    const implV1 = await ethers.deployContract("VestingManagerUpgradeable");
    const implV1Addr = await implV1.getAddress();
    const initData = implV1.interface.encodeFunctionData("initialize", [owner.address]);
    const proxy = await ethers.deployContract("ERC1967Proxy", [implV1Addr, initData]);
    const vestingAddr = await proxy.getAddress();
    const vesting = await ethers.getContractAt("VestingManagerUpgradeable", vestingAddr); // el proxy, visto como V1

    await token.mint(payer.address, 10n * AMOUNT);
    await token.connect(payer).approve(vestingAddr, ethers.MaxUint256);

    const start = (await now()) + START_DELAY;
    const end = start + 1000n;
    return { vesting, vestingAddr, implV1, implV1Addr, token, tokenAddr, owner, payer, beneficiary, stranger, start, end, initData };
  }

  async function implementationOf(proxyAddr) {
    const slot = await ethers.provider.getStorage(proxyAddr, IMPLEMENTATION_SLOT);
    return ethers.getAddress("0x" + slot.slice(26));
  }

  const create = (f, revocable = true) =>
    createdId(
      f.vesting,
      f.vesting.connect(f.payer).createAgreement(f.tokenAddr, f.beneficiary.address, AMOUNT, f.start, f.end, revocable),
    );

  /// Sube el proxy a la V2 (con migracion) como `owner`, en el segundo `ts` si se indica.
  async function upgradeToV2(f, ts) {
    const implV2 = await ethers.deployContract("VestingManagerUpgradeableV2");
    const data = implV2.interface.encodeFunctionData("initializeV2");
    if (ts !== undefined) await at(ts);
    await f.vesting.connect(f.owner).upgradeToAndCall(await implV2.getAddress(), data);
    const v2 = await ethers.getContractAt("VestingManagerUpgradeableV2", f.vestingAddr);
    return { implV2, implV2Addr: await implV2.getAddress(), v2 };
  }

  // ------------------------------------------------------------------ funcionamiento detras del proxy
  describe("Detras del proxy", function () {
    it("funciona igual que el contrato normal", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, vestingAddr, payer, beneficiary, start } = f;
      const id = await create(f);
      expect(id, "los ids empiezan en 1 tambien detras del proxy").to.equal(1);

      await at(start + 500n);
      await vesting.connect(beneficiary).claim(id);
      expect(await token.balanceOf(beneficiary.address)).to.equal(500_000_000n);

      await at(start + 500n);
      await vesting.connect(payer).cancel(id);
      expect((await vesting.getAgreement(id)).status).to.equal(Status.Cancelled);
      expect(await token.balanceOf(vestingAddr)).to.equal(0);
    });

    it("el proxy apunta a la implementacion y guarda el owner", async function () {
      const { vesting, vestingAddr, implV1Addr, owner } = await loadFixture(deployFixture);
      expect(await implementationOf(vestingAddr)).to.equal(implV1Addr);
      expect(await vesting.owner()).to.equal(owner.address);
    });

    /// El guard de reentrancia se inicializa en un constructor que solo corre en la implementacion; detras del
    /// proxy parte en 0. Este test comprueba que igual bloquea la reentrada.
    it("el guard de reentrancia sigue funcionando detras del proxy", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, vestingAddr, start, end } = f;
      const evil = await ethers.deployContract("ReentrantToken");
      const evilAddr = await evil.getAddress();
      await evil.mint(evilAddr, 10n * AMOUNT);
      await evil.exec(evilAddr, evil.interface.encodeFunctionData("approve", [vestingAddr, ethers.MaxUint256]));

      // el token malicioso es pagador y beneficiario, asi la reentrada pasaria los chequeos de acceso
      const createData = vesting.interface.encodeFunctionData("createAgreement", [
        evilAddr,
        evilAddr,
        AMOUNT,
        start,
        end,
        true,
      ]);
      await evil.exec(vestingAddr, createData);
      const id = (await vesting.getAgreementsByPayer(evilAddr))[0];

      const claimData = vesting.interface.encodeFunctionData("claim", [id]);
      await evil.arm(vestingAddr, claimData);
      await at(start + 500n);
      await evil.exec(vestingAddr, claimData);

      expect(await evil.reentered(), "el token intento reentrar").to.equal(true);
      expect(await evil.reentrySucceeded(), "la reentrada fallo").to.equal(false);
      expect((await evil.reentryError()).slice(0, 10)).to.equal(REENTRANCY_SELECTOR);
      expect((await vesting.getAgreement(id)).claimedAmount, "cobro una sola vez").to.equal(500_000_000n);
    });
  });

  // ------------------------------------------------------------------ inicializacion
  describe("Inicializacion", function () {
    it("la implementacion no se puede inicializar", async function () {
      const { implV1, stranger } = await loadFixture(deployFixture);
      await expect(implV1.initialize(stranger.address)).to.be.revertedWithCustomError(implV1, "InvalidInitialization");
    });

    it("el proxy no se puede inicializar dos veces", async function () {
      const { vesting, owner, stranger } = await loadFixture(deployFixture);
      await expect(vesting.initialize(stranger.address)).to.be.revertedWithCustomError(vesting, "InvalidInitialization");
      expect(await vesting.owner(), "el owner no cambio").to.equal(owner.address);
    });

    it("initialize rechaza un owner en cero", async function () {
      const { implV1, implV1Addr } = await loadFixture(deployFixture);
      const data = implV1.interface.encodeFunctionData("initialize", [ethers.ZeroAddress]);
      await expect(ethers.deployContract("ERC1967Proxy", [implV1Addr, data])).to.be.revertedWithCustomError(
        implV1,
        "ZeroAddress",
      );
    });
  });

  // ------------------------------------------------------------------ el upgrade conserva todo
  describe("El upgrade conserva el estado", function () {
    it("conserva todos los acuerdos, saldos e ids", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, vestingAddr, token, tokenAddr, owner, payer, beneficiary, start, end } = f;

      // --- estado previo: 4 acuerdos en distintos estados
      const active = await create(f, true); // 1: activo, con un reclamo parcial
      const fixedTerm = await create(f, false); // 2: no revocable
      const withCliff = await createdId(
        vesting,
        vesting
          .connect(payer)
          .createAgreementWithCliff(tokenAddr, beneficiary.address, AMOUNT, start, start + 300n, end, true),
      ); // 3: con cliff, se cancela
      const completed = await create(f, true); // 4: se completa

      await at(start + 500n);
      await vesting.connect(beneficiary).claim(active);
      await at(start + 500n);
      await vesting.connect(payer).cancel(withCliff);
      await at(end);
      await vesting.connect(beneficiary).claim(completed);

      const ids = [active, fixedTerm, withCliff, completed];
      const agreementsBefore = serialize(await vesting.getAgreements(ids));
      const payerListBefore = serialize(await vesting.getAgreementsByPayer(payer.address));
      const beneficiaryListBefore = serialize(await vesting.getAgreementsByBeneficiary(beneficiary.address));
      const contractBalanceBefore = await token.balanceOf(vestingAddr);
      const cliffBefore = await vesting.cliffOf(withCliff);

      // --- upgrade a la V2, con migracion
      const { implV2Addr, v2 } = await upgradeToV2(f, end);

      // --- se cambio la logica...
      expect(await implementationOf(vestingAddr), "ahora apunta a la V2").to.equal(implV2Addr);
      expect(await v2.version()).to.equal("v2");
      expect(await v2.agreementsAtUpgrade(), "la migracion vio los 4 acuerdos").to.equal(4);

      // --- ...y se conservo exactamente todo el estado
      expect(serialize(await v2.getAgreements(ids)), "acuerdos identicos").to.equal(agreementsBefore);
      expect(serialize(await v2.getAgreementsByPayer(payer.address))).to.equal(payerListBefore);
      expect(serialize(await v2.getAgreementsByBeneficiary(beneficiary.address))).to.equal(beneficiaryListBefore);
      expect(await token.balanceOf(vestingAddr), "los fondos siguen en el proxy").to.equal(contractBalanceBefore);
      expect(await v2.cliffOf(withCliff)).to.equal(cliffBefore);
      expect(await v2.owner()).to.equal(owner.address);
    });

    it("los acuerdos siguen funcionando despues del upgrade", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, token, tokenAddr, payer, beneficiary, start, end } = f;
      const id1 = await create(f, true);
      const id2 = await create(f, false);
      await at(start + 400n);
      await vesting.connect(beneficiary).claim(id1); // 400 antes del upgrade

      const { v2 } = await upgradeToV2(f, start + 400n);

      // el devengado previo se respeta: a +700 hay 700 devengados, 400 ya reclamados
      await warp(start + 700n);
      expect(await v2.claimableAmount(id1)).to.equal(300_000_000n);
      await at(start + 700n);
      await v2.connect(beneficiary).claim(id1);
      expect(await token.balanceOf(beneficiary.address)).to.equal(700_000_000n);

      // un acuerdo no revocable sigue sin poder cancelarse
      await at(start + 700n);
      await expect(v2.connect(payer).cancel(id2)).to.be.revertedWithCustomError(v2, "NotRevocable");

      // los acuerdos nuevos continuan la numeracion
      await at(start + 700n);
      const newId = await createdId(
        v2,
        v2.connect(payer).createAgreement(tokenAddr, beneficiary.address, AMOUNT, start + 700n, end, true),
      );
      expect(newId, "el contador de ids no se reinicio").to.equal(3);
    });
  });

  // ------------------------------------------------------------------ autorizacion del upgrade
  describe("Autorizacion del upgrade", function () {
    it("solo el owner puede actualizar", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, vestingAddr, implV1Addr, stranger, payer } = f;
      const implV2 = await ethers.deployContract("VestingManagerUpgradeableV2");
      const implV2Addr = await implV2.getAddress();

      await expect(vesting.connect(stranger).upgradeToAndCall(implV2Addr, "0x")).to.be.revertedWithCustomError(
        vesting,
        "NotOwner",
      );
      await expect(vesting.connect(payer).upgradeToAndCall(implV2Addr, "0x")).to.be.revertedWithCustomError(
        vesting,
        "NotOwner",
      );

      expect(await implementationOf(vestingAddr), "nada cambio").to.equal(implV1Addr);
    });

    it("no se puede actualizar a un contrato que no es UUPS", async function () {
      const { vesting, token, tokenAddr, owner } = await loadFixture(deployFixture);
      await expect(vesting.connect(owner).upgradeToAndCall(tokenAddr, "0x"))
        .to.be.revertedWithCustomError(vesting, "ERC1967InvalidImplementation")
        .withArgs(tokenAddr);
      void token;
    });

    it("upgradeToAndCall no se puede llamar directo sobre la implementacion", async function () {
      const { implV1, owner } = await loadFixture(deployFixture);
      const implV2 = await ethers.deployContract("VestingManagerUpgradeableV2");
      await expect(
        implV1.connect(owner).upgradeToAndCall(await implV2.getAddress(), "0x"),
      ).to.be.revertedWithCustomError(implV1, "UUPSUnauthorizedCallContext");
    });

    it("la migracion corre una sola vez", async function () {
      const f = await loadFixture(deployFixture);
      const { v2 } = await upgradeToV2(f);
      await expect(v2.initializeV2()).to.be.revertedWithCustomError(v2, "InvalidInitialization");
    });
  });

  // ------------------------------------------------------------------ owner
  describe("Owner", function () {
    it("transferOwnership: solo el owner, no admite cero, emite el evento y cambia quien puede actualizar", async function () {
      const f = await loadFixture(deployFixture);
      const { vesting, vestingAddr, owner, stranger } = f;
      const [newOwner] = (await ethers.getSigners()).slice(10);

      await expect(vesting.connect(stranger).transferOwnership(newOwner.address)).to.be.revertedWithCustomError(
        vesting,
        "NotOwner",
      );
      await expect(vesting.connect(owner).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        vesting,
        "ZeroAddress",
      );

      await expect(vesting.connect(owner).transferOwnership(newOwner.address))
        .to.emit(vesting, "OwnershipTransferred")
        .withArgs(owner.address, newOwner.address);
      expect(await vesting.owner()).to.equal(newOwner.address);

      // el dueno anterior ya no puede actualizar; el nuevo si
      const implV2 = await ethers.deployContract("VestingManagerUpgradeableV2");
      const implV2Addr = await implV2.getAddress();
      await expect(vesting.connect(owner).upgradeToAndCall(implV2Addr, "0x")).to.be.revertedWithCustomError(
        vesting,
        "NotOwner",
      );

      await vesting.connect(newOwner).upgradeToAndCall(implV2Addr, "0x");
      expect(await implementationOf(vestingAddr)).to.equal(implV2Addr);
    });
  });
});
