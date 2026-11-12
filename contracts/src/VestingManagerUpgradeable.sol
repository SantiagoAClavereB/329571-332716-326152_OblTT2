// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {VestingManager} from "./VestingManager.sol";

/// @title VestingManagerUpgradeable
/// @notice Variante del VestingManager para usarse detras de un proxy ERC-1967 con el patron UUPS (desafio
///         opcional B). Reutiliza toda la logica de VestingManager: el estado de los acuerdos vive en el proxy y
///         un upgrade cambia solo la logica, sin tocar los acuerdos existentes.
/// @dev Riesgo de confianza: el `owner` puede reemplazar la logica y por lo tanto, en teoria, mover los fondos.
///      En produccion deberia ser un multisig con timelock. Aca es una sola cuenta para mantenerlo simple.
contract VestingManagerUpgradeable is VestingManager, Initializable, UUPSUpgradeable {
    address public owner;

    error NotOwner();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev La implementacion nunca se inicializa: solo el proxy lo hace. Esto evita que alguien tome el control de
    ///      la implementacion directamente.
    constructor() {
        _disableInitializers();
    }

    /// @notice Reemplaza al constructor en el proxy. Solo se puede llamar una vez.
    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        _nextId = 1; // el valor inicial de la declaracion solo se aplica en el storage de la implementacion
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @dev UUPS: la autorizacion del upgrade vive en la implementacion. Si una version nueva la perdiera, el
    ///      proxy quedaria sin posibilidad de volver a actualizarse.
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
