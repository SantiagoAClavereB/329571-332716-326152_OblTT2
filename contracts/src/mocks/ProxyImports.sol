// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Hardhat solo genera artifacts de los contratos que se importan desde src/. El proxy ERC-1967 lo necesitan los
// tests y el script de deploy upgradeable, pero ningun contrato de src/ lo importa: este archivo lo trae.
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Evita que el linter marque el import como no usado.
abstract contract ProxyImports {
    function _proxyType() internal pure returns (bytes memory) {
        return type(ERC1967Proxy).creationCode;
    }
}
