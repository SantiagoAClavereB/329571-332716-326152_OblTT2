// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IVestingManager} from "./IVestingManager.sol";

/// @title VestingManager
/// @notice Un solo contrato administra todos los acuerdos de vesting lineal entre un pagador y un beneficiario.
contract VestingManager is IVestingManager, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Los ids empiezan en 1 para que el id 0 nunca sea un acuerdo valido.
    uint256 private _nextId = 1;

    mapping(uint256 id => Agreement) private _agreements;
    mapping(address payer => uint256[]) private _idsByPayer;
    mapping(address beneficiary => uint256[]) private _idsByBeneficiary;
    /// @dev Cliff por acuerdo, aparte del struct para no cambiar el ABI que ya usa la dApp. 0 = sin cliff.
    mapping(uint256 id => uint48) private _cliffTime;

    // ------------------------------------------------------------------ Escrituras

    /// @inheritdoc IVestingManager
    function createAgreement(
        address token,
        address beneficiary,
        uint256 amount,
        uint48 startTime,
        uint48 endTime,
        bool revocable
    ) external nonReentrant returns (uint256 id) {
        _validate(token, beneficiary, amount, startTime, endTime);
        _pull(token, amount);
        id = _store(token, beneficiary, amount, startTime, endTime, revocable);
    }

    /// @inheritdoc IVestingManager
    function createAgreementWithCliff(
        address token,
        address beneficiary,
        uint256 amount,
        uint48 startTime,
        uint48 cliffTime,
        uint48 endTime,
        bool revocable
    ) external nonReentrant returns (uint256 id) {
        _validate(token, beneficiary, amount, startTime, endTime);
        // El cliff 0 significa "sin cliff", asi que un cliff explicito debe caer dentro del periodo.
        if (cliffTime < startTime || cliffTime > endTime) revert InvalidCliff();
        _pull(token, amount);
        id = _store(token, beneficiary, amount, startTime, endTime, revocable);
        _cliffTime[id] = cliffTime;
        emit CliffConfigured(id, cliffTime);
    }

    /// @inheritdoc IVestingManager
    function claim(uint256 id) external nonReentrant {
        Agreement storage a = _getStorage(id);
        if (msg.sender != a.beneficiary) revert NotBeneficiary();

        // Sirve tambien para un acuerdo cancelado: _vested devuelve lo congelado al cancelar.
        uint256 amount = _vested(id, a) - a.claimedAmount;
        if (amount == 0) revert NothingToClaim();

        // Efectos antes de la transferencia externa (checks-effects-interactions).
        a.claimedAmount += amount;
        if (a.status == Status.Active && a.claimedAmount == a.totalAmount) {
            a.status = Status.Completed;
        }
        emit Claimed(id, msg.sender, amount);

        IERC20(a.token).safeTransfer(msg.sender, amount);
    }

    /// @inheritdoc IVestingManager
    function cancel(uint256 id) external nonReentrant {
        Agreement storage a = _getStorage(id);
        if (msg.sender != a.payer) revert NotPayer();
        if (a.status != Status.Active) revert NotActive();
        if (!a.revocable) revert NotRevocable();
        if (block.timestamp >= a.endTime) revert AlreadyEnded();

        // Se congela lo devengado: el beneficiario lo conserva y puede reclamarlo despues.
        uint256 vested = _linearVested(a.totalAmount, a.startTime, _cliffTime[id], a.endTime);
        uint256 refund = a.totalAmount - vested;

        a.status = Status.Cancelled;
        a.vestedAtCancel = vested;
        emit AgreementCancelled(id, msg.sender, refund, vested);

        if (refund > 0) IERC20(a.token).safeTransfer(a.payer, refund);
    }

    // -------------------------------------------------------------------- Lecturas

    /// @inheritdoc IVestingManager
    function vestedAmount(uint256 id) external view returns (uint256) {
        return _vested(id, _getStorage(id));
    }

    /// @inheritdoc IVestingManager
    function claimableAmount(uint256 id) external view returns (uint256) {
        Agreement storage a = _getStorage(id);
        return _vested(id, a) - a.claimedAmount;
    }

    /// @inheritdoc IVestingManager
    function cliffOf(uint256 id) external view returns (uint48) {
        _getStorage(id); // revierte si el acuerdo no existe
        return _cliffTime[id];
    }

    /// @inheritdoc IVestingManager
    function getAgreement(uint256 id) external view returns (Agreement memory) {
        return _getStorage(id);
    }

    /// @inheritdoc IVestingManager
    /// @dev `ids` va en calldata: se lee directo de los datos de la transaccion sin copiarlo a memoria.
    ///      El resultado va en memory porque es nuevo, de largo conocido, y se devuelve al llamador.
    function getAgreements(uint256[] calldata ids) external view returns (AgreementSummary[] memory result) {
        result = new AgreementSummary[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            Agreement storage a = _getStorage(ids[i]);
            uint256 vested = _vested(ids[i], a);
            result[i] = AgreementSummary({agreement: a, vested: vested, claimable: vested - a.claimedAmount});
        }
    }

    /// @inheritdoc IVestingManager
    function getAgreementsByPayer(address payer) external view returns (uint256[] memory) {
        return _idsByPayer[payer];
    }

    /// @inheritdoc IVestingManager
    function getAgreementsByBeneficiary(address beneficiary) external view returns (uint256[] memory) {
        return _idsByBeneficiary[beneficiary];
    }

    // --------------------------------------------------------------------- Internas

    /// @dev Devuelve un puntero a storage (sin copiar el struct completo) y revierte si el id no existe.
    function _getStorage(uint256 id) private view returns (Agreement storage a) {
        a = _agreements[id];
        if (a.payer == address(0)) revert AgreementNotFound();
    }

    /// @dev Validaciones comunes a toda forma de crear un acuerdo.
    function _validate(address token, address beneficiary, uint256 amount, uint48 startTime, uint48 endTime)
        private
        view
    {
        if (token == address(0)) revert ZeroAddress();
        if (beneficiary == address(0) || beneficiary == address(this)) revert InvalidBeneficiary();
        if (amount == 0) revert ZeroAmount();
        // Se permite un inicio pasado, pero el acuerdo debe terminar en el futuro y despues de empezar.
        if (endTime <= startTime || endTime <= block.timestamp) revert InvalidTimeRange();
    }

    /// @dev Toma los fondos del pagador. Se mide el balance real recibido: un token con comision por
    ///      transferencia dejaria el acuerdo sub-fondeado.
    function _pull(address token, uint256 amount) private {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - balanceBefore != amount) revert FeeOnTransferNotSupported();
    }

    /// @dev Guarda el acuerdo con una sola escritura del struct (cada slot empaquetado se escribe una vez),
    ///      lo agrega a los listados y emite el evento.
    function _store(
        address token,
        address beneficiary,
        uint256 amount,
        uint48 startTime,
        uint48 endTime,
        bool revocable
    ) private returns (uint256 id) {
        id = _nextId++;
        _agreements[id] = Agreement({
            payer: msg.sender,
            startTime: startTime,
            endTime: endTime,
            beneficiary: beneficiary,
            status: Status.Active,
            revocable: revocable,
            token: token,
            totalAmount: amount,
            claimedAmount: 0,
            vestedAtCancel: 0
        });
        _idsByPayer[msg.sender].push(id);
        _idsByBeneficiary[beneficiary].push(id);

        emit AgreementCreated(id, msg.sender, beneficiary, token, amount, startTime, endTime, revocable);
    }

    /// @dev Cancelado: lo devengado esta congelado. En otro caso crece linealmente con el tiempo.
    function _vested(uint256 id, Agreement storage a) private view returns (uint256) {
        if (a.status == Status.Cancelled) return a.vestedAtCancel;
        return _linearVested(a.totalAmount, a.startTime, _cliffTime[id], a.endTime);
    }

    /// @dev total * (t - start) / (end - start). Antes de start (o del cliff, si hay) es 0 y desde end es total.
    ///      mulDiv multiplica primero sin overflow intermedio y redondea hacia abajo: nunca paga de mas.
    ///      Despues del cliff el devengado es el lineal calculado desde start, no desde el cliff.
    function _linearVested(uint256 total, uint48 start, uint48 cliff, uint48 end) private view returns (uint256) {
        if (block.timestamp < cliff) return 0; // cliff == 0 nunca entra aca
        if (block.timestamp <= start) return 0;
        if (block.timestamp >= end) return total;
        return Math.mulDiv(total, block.timestamp - start, end - start);
    }
}
