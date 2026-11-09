// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IVestingManager
/// @notice Interfaz congelada del contrato de vesting. Un solo contrato guarda todos los acuerdos.
interface IVestingManager {
    /// @dev Estados (seccion 3 de la letra). Active: vigente. Completed: termino el periodo y se reclamo todo.
    ///      Cancelled: el pagador cancelo un acuerdo revocable; lo devengado queda para el beneficiario.
    enum Status {
        Active,
        Completed,
        Cancelled
    }

    /// @dev Struct empaquetado: slot 1 = payer + startTime + endTime (160+48+48 = 256 bits),
    ///      slot 2 = beneficiary + status + revocable (160+8+8), slot 3 = token, slots 4-6 = montos.
    struct Agreement {
        address payer;
        uint48 startTime;
        uint48 endTime;
        address beneficiary;
        Status status;
        bool revocable;
        address token;
        uint256 totalAmount; // monto bloqueado al crear
        uint256 claimedAmount; // lo que el beneficiario ya retiro
        uint256 vestedAtCancel; // devengado congelado al cancelar (0 si sigue activo)
    }

    /// @dev Lo que devuelve getAgreements: el acuerdo y los montos calculados al momento de la consulta.
    struct AgreementSummary {
        Agreement agreement;
        uint256 vested; // igual a vestedAmount(id)
        uint256 claimable; // igual a claimableAmount(id)
    }

    // ---------------------------------------------------------------- Eventos
    event AgreementCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed beneficiary,
        address token,
        uint256 totalAmount,
        uint48 startTime,
        uint48 endTime,
        bool revocable
    );
    event Claimed(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event AgreementCancelled(uint256 indexed id, address indexed payer, uint256 refundedToPayer, uint256 vestedAtCancel);

    // ---------------------------------------------------------------- Errores
    error ZeroAddress();
    error InvalidBeneficiary(); // address(0) o address(this)
    error ZeroAmount();
    error InvalidTimeRange(); // endTime <= startTime o endTime en el pasado
    error FeeOnTransferNotSupported(); // el balance recibido != monto pedido
    error AgreementNotFound();
    error NotPayer();
    error NotBeneficiary();
    error NotActive();
    error NotRevocable(); // cancelar un acuerdo no revocable
    error AlreadyEnded(); // cancelar despues de endTime
    error NothingToClaim();

    // -------------------------------------------------------------- Escrituras
    /// @notice Crea un acuerdo y bloquea `amount` de `token` (requiere approve previo).
    function createAgreement(
        address token,
        address beneficiary,
        uint256 amount,
        uint48 startTime,
        uint48 endTime,
        bool revocable
    ) external returns (uint256 id);

    /// @notice El beneficiario retira lo devengado y aun no reclamado. nonReentrant.
    function claim(uint256 id) external;

    /// @notice El pagador cancela un acuerdo revocable: se congela lo devengado y se devuelve el resto.
    ///         Revierte si no es revocable (NotRevocable) o si ya paso endTime (AlreadyEnded).
    function cancel(uint256 id) external;

    // ---------------------------------------------------------------- Lecturas
    function vestedAmount(uint256 id) external view returns (uint256);
    function claimableAmount(uint256 id) external view returns (uint256);
    function getAgreement(uint256 id) external view returns (Agreement memory);
    function getAgreementsByPayer(address payer) external view returns (uint256[] memory);
    function getAgreementsByBeneficiary(address beneficiary) external view returns (uint256[] memory);

    /// @notice Lectura en lote: acuerdo + devengado + disponible de cada id, en el mismo orden.
    ///         Revierte con AgreementNotFound si algún id no existe.
    /// @dev `ids` es calldata: solo se lee, así que no se copia a memory (más barato que `uint256[] memory`).
    function getAgreements(uint256[] calldata ids) external view returns (AgreementSummary[] memory);
}
