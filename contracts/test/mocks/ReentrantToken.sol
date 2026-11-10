// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token malicioso: cuando mueve fondos desde o hacia `attackTarget`, intenta reentrar al contrato
///         ejecutando `attackData`. Guarda si la reentrada funciono y con que error fallo.
contract ReentrantToken is ERC20 {
    address public attackTarget;
    bytes public attackData;
    bool public reentered;
    bool public reentrySucceeded;
    bytes public reentryError;

    constructor() ERC20("Evil", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Configura el ataque y lo rearma (permite una reentrada por configuracion).
    function arm(address target, bytes calldata data) external {
        attackTarget = target;
        attackData = data;
        reentered = false;
        reentrySucceeded = false;
        delete reentryError;
    }

    /// @dev Permite que este contrato sea el msg.sender de una llamada (para ser pagador o beneficiario).
    function exec(address to, bytes calldata data) external returns (bytes memory ret) {
        bool ok;
        (ok, ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        address target = attackTarget;
        if (target != address(0) && !reentered && (from == target || to == target)) {
            reentered = true;
            (bool ok, bytes memory ret) = target.call(attackData);
            reentrySucceeded = ok;
            reentryError = ret;
        }
    }
}
