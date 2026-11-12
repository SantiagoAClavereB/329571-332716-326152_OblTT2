// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockToken} from "../src/MockToken.sol";
import {VestingManager} from "../src/VestingManager.sol";

/// @notice Ejecuta las operaciones relevantes sobre un VestingManager ya desplegado, para poder comparar su costo
///         entre redes (desafio opcional D): mint + approve + createAgreement + claim + createAgreement + cancel.
///         Todas las transacciones las firma la misma cuenta, que es a la vez pagador y beneficiario.
///
/// Variables de entorno:
///   VESTING = direccion del VestingManager       TOKEN = direccion de un MockToken (mint abierto)
///
/// Luego, con el resultado en broadcast/MeasureOps.s.sol/<chainId>/run-latest.json:
///   node script/compare-costs.mjs <run-latest.json> [otro run-latest.json ...]
contract MeasureOps is Script {
    function run() external {
        VestingManager vesting = VestingManager(vm.envAddress("VESTING"));
        MockToken token = MockToken(vm.envAddress("TOKEN"));

        uint256 amount = 100 * 10 ** token.decimals();
        // Inicio pasado (se permite) para que ya haya algo devengado y el claim funcione de inmediato.
        uint48 start = uint48(block.timestamp - 100);
        uint48 end = uint48(block.timestamp + 1 days);

        vm.startBroadcast();
        address me = msg.sender;

        token.mint(me, 2 * amount);
        token.approve(address(vesting), 2 * amount);

        uint256 first = vesting.createAgreement(address(token), me, amount, start, end, true);
        vesting.claim(first);

        uint256 second = vesting.createAgreement(address(token), me, amount, start, end, true);
        vesting.cancel(second);
        vm.stopBroadcast();

        console.log("acuerdo reclamado:", first);
        console.log("acuerdo cancelado:", second);
    }
}
