// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IVestingManager} from "../src/IVestingManager.sol";
import {VestingManagerUpgradeable} from "../src/VestingManagerUpgradeable.sol";
import {MockToken} from "../src/MockToken.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VestingManagerUpgradeableV2} from "./mocks/VestingManagerUpgradeableV2.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

/// Desafio opcional B: upgradeabilidad UUPS. Un upgrade tiene que conservar todos los acuerdos existentes.
contract VestingUpgradeableTest is Test {
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    VestingManagerUpgradeable internal implV1;
    VestingManagerUpgradeable internal vesting; // el proxy, visto como V1
    MockToken internal token;

    address internal owner = makeAddr("owner");
    address internal payer = makeAddr("payer");
    address internal beneficiary = makeAddr("beneficiary");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant AMOUNT = 1_000e6;
    uint48 internal start;
    uint48 internal end;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockToken("Test USD", "tUSD", 6);

        implV1 = new VestingManagerUpgradeable();
        vesting = _deployProxy(owner);

        token.mint(payer, 10 * AMOUNT);
        vm.prank(payer);
        token.approve(address(vesting), type(uint256).max);

        start = uint48(block.timestamp + 10);
        end = start + 1000;
    }

    function _deployProxy(address owner_) internal returns (VestingManagerUpgradeable) {
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(implV1), abi.encodeCall(VestingManagerUpgradeable.initialize, (owner_)));
        return VestingManagerUpgradeable(address(proxy));
    }

    function _implementationOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, IMPLEMENTATION_SLOT))));
    }

    function _create(bool revocable) internal returns (uint256 id) {
        vm.prank(payer);
        id = vesting.createAgreement(address(token), beneficiary, AMOUNT, start, end, revocable);
    }

    // ------------------------------------------------------------------ funcionamiento detras del proxy

    function test_upgradeable_worksLikeTheNormalContractBehindTheProxy() public {
        uint256 id = _create(true);
        assertEq(id, 1, "los ids empiezan en 1 tambien detras del proxy");

        vm.warp(start + 500);
        vm.prank(beneficiary);
        vesting.claim(id);
        assertEq(token.balanceOf(beneficiary), 500e6);

        vm.prank(payer);
        vesting.cancel(id);
        assertEq(uint8(vesting.getAgreement(id).status), uint8(IVestingManager.Status.Cancelled));
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    function test_upgradeable_proxyPointsToTheImplementationAndKeepsOwner() public view {
        assertEq(_implementationOf(address(vesting)), address(implV1));
        assertEq(vesting.owner(), owner);
    }

    /// El guard de reentrancia se inicializa en un constructor que solo corre en la implementacion; detras del
    /// proxy parte en 0. Este test comprueba que igual bloquea la reentrada.
    function test_upgradeable_reentrancyGuardStillWorksBehindTheProxy() public {
        ReentrantToken evil = new ReentrantToken();
        evil.mint(address(evil), 10 * AMOUNT);
        evil.exec(address(evil), abi.encodeCall(evil.approve, (address(vesting), type(uint256).max)));
        // el token malicioso es pagador y beneficiario, asi la reentrada pasaria los chequeos de acceso
        bytes memory ret = evil.exec(
            address(vesting),
            abi.encodeCall(vesting.createAgreement, (address(evil), address(evil), AMOUNT, start, end, true))
        );
        uint256 id = abi.decode(ret, (uint256));

        vm.warp(start + 500);
        evil.arm(address(vesting), abi.encodeCall(vesting.claim, (id)));
        evil.exec(address(vesting), abi.encodeCall(vesting.claim, (id)));

        assertTrue(evil.reentered(), "el token intento reentrar");
        assertFalse(evil.reentrySucceeded(), "la reentrada fallo");
        assertEq(bytes4(evil.reentryError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(vesting.getAgreement(id).claimedAmount, 500e6, "cobro una sola vez");
    }

    // ------------------------------------------------------------------ inicializacion

    function test_upgradeable_implementationCannotBeInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implV1.initialize(stranger);
    }

    function test_upgradeable_proxyCannotBeInitializedTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vesting.initialize(stranger);
        assertEq(vesting.owner(), owner, "el owner no cambio");
    }

    function test_upgradeable_initializeRejectsZeroOwner() public {
        vm.expectRevert(IVestingManager.ZeroAddress.selector);
        new ERC1967Proxy(address(implV1), abi.encodeCall(VestingManagerUpgradeable.initialize, (address(0))));
    }

    // ------------------------------------------------------------------ el upgrade conserva todo

    function test_upgrade_preservesAllAgreementsBalancesAndIds() public {
        // --- estado previo: 4 acuerdos en distintos estados
        uint256 active = _create(true); // 1: activo, con un reclamo parcial
        uint256 fixedTerm = _create(false); // 2: no revocable
        vm.prank(payer);
        uint256 withCliff = vesting.createAgreementWithCliff(
            address(token), beneficiary, AMOUNT, start, start + 300, end, true
        ); // 3: con cliff, se cancela
        uint256 completed = _create(true); // 4: se completa

        vm.warp(start + 500);
        vm.prank(beneficiary);
        vesting.claim(active);
        vm.prank(payer);
        vesting.cancel(withCliff);

        vm.warp(end);
        vm.prank(beneficiary);
        vesting.claim(completed);

        uint256[] memory ids = new uint256[](4);
        ids[0] = active;
        ids[1] = fixedTerm;
        ids[2] = withCliff;
        ids[3] = completed;

        bytes32 agreementsBefore = keccak256(abi.encode(vesting.getAgreements(ids)));
        bytes32 payerListBefore = keccak256(abi.encode(vesting.getAgreementsByPayer(payer)));
        bytes32 beneficiaryListBefore = keccak256(abi.encode(vesting.getAgreementsByBeneficiary(beneficiary)));
        uint256 contractBalanceBefore = token.balanceOf(address(vesting));
        uint48 cliffBefore = vesting.cliffOf(withCliff);

        // --- upgrade a la V2, con migracion
        VestingManagerUpgradeableV2 implV2 = new VestingManagerUpgradeableV2();
        vm.prank(owner);
        vesting.upgradeToAndCall(address(implV2), abi.encodeCall(VestingManagerUpgradeableV2.initializeV2, ()));

        VestingManagerUpgradeableV2 v2 = VestingManagerUpgradeableV2(address(vesting));

        // --- se cambio la logica...
        assertEq(_implementationOf(address(vesting)), address(implV2), "ahora apunta a la V2");
        assertEq(v2.version(), "v2");
        assertEq(v2.agreementsAtUpgrade(), 4, "la migracion vio los 4 acuerdos");

        // --- ...y se conservo exactamente todo el estado
        assertEq(keccak256(abi.encode(v2.getAgreements(ids))), agreementsBefore, "acuerdos identicos");
        assertEq(keccak256(abi.encode(v2.getAgreementsByPayer(payer))), payerListBefore);
        assertEq(keccak256(abi.encode(v2.getAgreementsByBeneficiary(beneficiary))), beneficiaryListBefore);
        assertEq(token.balanceOf(address(v2)), contractBalanceBefore, "los fondos siguen en el proxy");
        assertEq(v2.cliffOf(withCliff), cliffBefore);
        assertEq(v2.owner(), owner);
    }

    function test_upgrade_agreementsKeepWorkingAfterTheUpgrade() public {
        uint256 id1 = _create(true);
        uint256 id2 = _create(false);
        vm.warp(start + 400);
        vm.prank(beneficiary);
        vesting.claim(id1); // 400 antes del upgrade

        VestingManagerUpgradeableV2 implV2 = new VestingManagerUpgradeableV2();
        vm.prank(owner);
        vesting.upgradeToAndCall(address(implV2), abi.encodeCall(VestingManagerUpgradeableV2.initializeV2, ()));
        VestingManagerUpgradeableV2 v2 = VestingManagerUpgradeableV2(address(vesting));

        // el devengado previo se respeta: a +700 hay 700 devengados, 400 ya reclamados
        vm.warp(start + 700);
        assertEq(v2.claimableAmount(id1), 300e6);
        vm.prank(beneficiary);
        v2.claim(id1);
        assertEq(token.balanceOf(beneficiary), 700e6);

        // un acuerdo no revocable sigue sin poder cancelarse
        vm.prank(payer);
        vm.expectRevert(IVestingManager.NotRevocable.selector);
        v2.cancel(id2);

        // los acuerdos nuevos continuan la numeracion
        vm.prank(payer);
        uint256 newId = v2.createAgreement(address(token), beneficiary, AMOUNT, uint48(block.timestamp), end, true);
        assertEq(newId, 3, "el contador de ids no se reinicio");
    }

    // ------------------------------------------------------------------ autorizacion del upgrade

    function test_upgrade_onlyOwnerCanUpgrade() public {
        VestingManagerUpgradeableV2 implV2 = new VestingManagerUpgradeableV2();

        vm.prank(stranger);
        vm.expectRevert(VestingManagerUpgradeable.NotOwner.selector);
        vesting.upgradeToAndCall(address(implV2), "");

        vm.prank(payer);
        vm.expectRevert(VestingManagerUpgradeable.NotOwner.selector);
        vesting.upgradeToAndCall(address(implV2), "");

        assertEq(_implementationOf(address(vesting)), address(implV1), "nada cambio");
    }

    function test_upgrade_cannotUpgradeToAContractThatIsNotUUPS() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ERC1967Utils.ERC1967InvalidImplementation.selector, address(token)));
        vesting.upgradeToAndCall(address(token), "");
    }

    function test_upgrade_cannotBeCalledDirectlyOnTheImplementation() public {
        VestingManagerUpgradeableV2 implV2 = new VestingManagerUpgradeableV2();
        vm.prank(owner);
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        implV1.upgradeToAndCall(address(implV2), "");
    }

    function test_upgrade_migrationRunsOnlyOnce() public {
        VestingManagerUpgradeableV2 implV2 = new VestingManagerUpgradeableV2();
        vm.prank(owner);
        vesting.upgradeToAndCall(address(implV2), abi.encodeCall(VestingManagerUpgradeableV2.initializeV2, ()));

        vm.expectRevert(Initializable.InvalidInitialization.selector);
        VestingManagerUpgradeableV2(address(vesting)).initializeV2();
    }

    // ------------------------------------------------------------------ owner

    function test_owner_transferOwnership() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(stranger);
        vm.expectRevert(VestingManagerUpgradeable.NotOwner.selector);
        vesting.transferOwnership(newOwner);

        vm.prank(owner);
        vm.expectRevert(IVestingManager.ZeroAddress.selector);
        vesting.transferOwnership(address(0));

        vm.expectEmit(true, true, false, false);
        emit VestingManagerUpgradeable.OwnershipTransferred(owner, newOwner);
        vm.prank(owner);
        vesting.transferOwnership(newOwner);
        assertEq(vesting.owner(), newOwner);

        // el dueno anterior ya no puede actualizar; el nuevo si
        VestingManagerUpgradeableV2 implV2 = new VestingManagerUpgradeableV2();
        vm.prank(owner);
        vm.expectRevert(VestingManagerUpgradeable.NotOwner.selector);
        vesting.upgradeToAndCall(address(implV2), "");

        vm.prank(newOwner);
        vesting.upgradeToAndCall(address(implV2), "");
        assertEq(_implementationOf(address(vesting)), address(implV2));
    }
}
