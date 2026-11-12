// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockToken} from "../src/MockToken.sol";
import {MockPermitToken} from "../src/MockPermitToken.sol";
import {VestingManager} from "../src/VestingManager.sol";

/// @notice Despliega el token de prueba y el VestingManager, y deja las direcciones en
///         frontend/public/deployments.json (indexado por chainId) para que Angular las lea.
///
/// Uso local (Anvil):
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
contract Deploy is Script {
    string internal constant DEPLOYMENTS_FILE = "../frontend/public/deployments.json";
    uint8 internal constant TOKEN_DECIMALS = 6;
    uint256 internal constant INITIAL_MINT = 1_000_000 * 10 ** TOKEN_DECIMALS;

    function run() external returns (VestingManager vesting, MockToken token) {
        vm.startBroadcast();
        token = new MockToken("Test USD", "tUSD", TOKEN_DECIMALS);
        // Token con soporte EIP-2612 para probar createAgreementWithPermit (desafio opcional E).
        MockPermitToken permitToken = new MockPermitToken("Permit USD", "pUSD", TOKEN_DECIMALS);
        vesting = new VestingManager();
        token.mint(msg.sender, INITIAL_MINT);
        permitToken.mint(msg.sender, INITIAL_MINT);
        vm.stopBroadcast();

        console.log("MockToken:       ", address(token));
        console.log("MockPermitToken: ", address(permitToken));
        console.log("VestingManager:  ", address(vesting));

        _writeDeployment(address(vesting), address(token), address(permitToken));
    }

    /// @dev Agrega o actualiza la entrada de la red actual sin pisar las de otras redes.
    function _writeDeployment(address vesting, address token, address permitToken) internal {
        if (!vm.exists(DEPLOYMENTS_FILE)) vm.writeFile(DEPLOYMENTS_FILE, "{}");

        string memory key = vm.toString(block.chainid);
        string memory entry = "entry";
        vm.serializeAddress(entry, "vestingManager", vesting);
        vm.serializeAddress(entry, "mockToken", token);
        vm.serializeAddress(entry, "mockPermitToken", permitToken);
        string memory json = vm.serializeUint(entry, "deployBlock", block.number);

        vm.writeJson(json, DEPLOYMENTS_FILE, string.concat(".", key));
    }
}
