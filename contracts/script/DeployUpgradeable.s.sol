// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockToken} from "../src/MockToken.sol";
import {MockPermitToken} from "../src/MockPermitToken.sol";
import {VestingManagerUpgradeable} from "../src/VestingManagerUpgradeable.sol";

/// @notice Despliega la variante UUPS: implementacion + proxy ERC-1967 (desafio opcional B).
///         `vestingManager` en deployments.json es la direccion del PROXY: es la que usa la dApp y no cambia
///         aunque se actualice la implementacion. El owner del proxy es quien ejecuta el script.
///
/// Uso local (Anvil):
///   forge script script/DeployUpgradeable.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
///
/// Para no pisar el deployments.json de la version no upgradeable:
///   DEPLOYMENTS_FILE=../frontend/public/otro.json forge script ...
contract DeployUpgradeable is Script {
    uint8 internal constant TOKEN_DECIMALS = 6;
    uint256 internal constant INITIAL_MINT = 1_000_000 * 10 ** TOKEN_DECIMALS;

    function run() external returns (address proxy, address implementation) {
        string memory file = vm.envOr("DEPLOYMENTS_FILE", string("../frontend/public/deployments.json"));

        vm.startBroadcast();
        MockToken token = new MockToken("Test USD", "tUSD", TOKEN_DECIMALS);
        MockPermitToken permitToken = new MockPermitToken("Permit USD", "pUSD", TOKEN_DECIMALS);
        VestingManagerUpgradeable impl = new VestingManagerUpgradeable();
        ERC1967Proxy proxyContract =
            new ERC1967Proxy(address(impl), abi.encodeCall(VestingManagerUpgradeable.initialize, (msg.sender)));
        token.mint(msg.sender, INITIAL_MINT);
        permitToken.mint(msg.sender, INITIAL_MINT);
        vm.stopBroadcast();

        proxy = address(proxyContract);
        implementation = address(impl);

        console.log("MockToken:       ", address(token));
        console.log("MockPermitToken: ", address(permitToken));
        console.log("Implementacion:  ", implementation);
        console.log("Proxy (usar este):", proxy);

        _writeDeployment(file, proxy, implementation, address(token), address(permitToken));
    }

    function _writeDeployment(
        string memory file,
        address proxy,
        address implementation,
        address token,
        address permitToken
    ) internal {
        if (!vm.exists(file)) vm.writeFile(file, "{}");

        string memory entry = "entry";
        vm.serializeAddress(entry, "vestingManager", proxy);
        vm.serializeAddress(entry, "implementation", implementation);
        vm.serializeAddress(entry, "mockToken", token);
        vm.serializeAddress(entry, "mockPermitToken", permitToken);
        string memory json = vm.serializeUint(entry, "deployBlock", block.number);

        vm.writeJson(json, file, string.concat(".", vm.toString(block.chainid)));
    }
}
