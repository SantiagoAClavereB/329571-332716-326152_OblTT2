// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VestingManagerUpgradeable} from "../VestingManagerUpgradeable.sol";

/// @notice "Version 2" de prueba: agrega una variable de estado NUEVA al final del storage y una funcion nueva.
///         Sirve para demostrar que un upgrade conserva los acuerdos y permite migrar datos con `reinitializer`.
contract VestingManagerUpgradeableV2 is VestingManagerUpgradeable {
    /// @dev Variable nueva: se agrega al final, despues de todo el storage de la V1.
    uint256 public agreementsAtUpgrade;

    /// @notice Se ejecuta una sola vez en el upgrade (reinitializer(2)) para migrar datos.
    function initializeV2() external reinitializer(2) {
        agreementsAtUpgrade = _nextId - 1; // cantidad de acuerdos que existian al actualizar
    }

    function version() external pure returns (string memory) {
        return "v2";
    }
}
