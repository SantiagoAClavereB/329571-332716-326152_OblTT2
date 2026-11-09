/**
 * ABIs en formato "human-readable" de Ethers.
 * VESTING_ABI refleja `contracts/src/IVestingManager.sol` (interfaz congelada en la Fase 1):
 * si la interfaz cambia, hay que actualizar esto.
 */

const AGREEMENT_TUPLE =
  'tuple(address payer, uint48 startTime, uint48 endTime, address beneficiary, uint8 status, bool revocable, address token, uint256 totalAmount, uint256 claimedAmount, uint256 vestedAtCancel)';

export const VESTING_ABI = [
  // Escrituras
  'function createAgreement(address token, address beneficiary, uint256 amount, uint48 startTime, uint48 endTime, bool revocable) returns (uint256 id)',
  'function claim(uint256 id)',
  'function cancel(uint256 id)',

  // Lecturas
  'function vestedAmount(uint256 id) view returns (uint256)',
  'function claimableAmount(uint256 id) view returns (uint256)',
  `function getAgreement(uint256 id) view returns (${AGREEMENT_TUPLE})`,
  'function getAgreementsByPayer(address payer) view returns (uint256[])',
  'function getAgreementsByBeneficiary(address beneficiary) view returns (uint256[])',

  // Eventos
  'event AgreementCreated(uint256 indexed id, address indexed payer, address indexed beneficiary, address token, uint256 totalAmount, uint48 startTime, uint48 endTime, bool revocable)',
  'event Claimed(uint256 indexed id, address indexed beneficiary, uint256 amount)',
  'event AgreementCancelled(uint256 indexed id, address indexed payer, uint256 refundedToPayer, uint256 vestedAtCancel)',

  // Custom errors (para que Ethers los decodifique en los reverts)
  'error ZeroAddress()',
  'error InvalidBeneficiary()',
  'error ZeroAmount()',
  'error InvalidTimeRange()',
  'error FeeOnTransferNotSupported()',
  'error AgreementNotFound()',
  'error NotPayer()',
  'error NotBeneficiary()',
  'error NotActive()',
  'error NotRevocable()',
  'error AlreadyEnded()',
  'error NothingToClaim()',
];

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  // Errores de OpenZeppelin ERC20 (v5)
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
];
