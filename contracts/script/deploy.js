// Despliega el token de prueba, un token con soporte EIP-2612 y el VestingManager, y deja las direcciones en
// frontend/public/deployments.json (indexado por chainId) para que Angular las lea.
//
// Uso local (nodo de `npm run node` en otra terminal):
//   npm run deploy:local
// Otra red: npx hardhat run script/deploy.js --network <nombre>
const { ethers } = require("hardhat");
const { writeDeployment } = require("./lib/writeDeployment");

const TOKEN_DECIMALS = 6;
const INITIAL_MINT = 1_000_000n * 10n ** BigInt(TOKEN_DECIMALS);

async function main() {
  const [deployer] = await ethers.getSigners();

  const token = await ethers.deployContract("MockToken", ["Test USD", "tUSD", TOKEN_DECIMALS]);
  // Token con soporte EIP-2612 para probar createAgreementWithPermit (desafio opcional E).
  const permitToken = await ethers.deployContract("MockPermitToken", ["Permit USD", "pUSD", TOKEN_DECIMALS]);
  const vesting = await ethers.deployContract("VestingManager");

  await (await token.mint(deployer.address, INITIAL_MINT)).wait();
  await (await permitToken.mint(deployer.address, INITIAL_MINT)).wait();

  const deployBlock = (await vesting.deploymentTransaction().wait()).blockNumber;
  const { chainId } = await ethers.provider.getNetwork();

  console.log("MockToken:       ", await token.getAddress());
  console.log("MockPermitToken: ", await permitToken.getAddress());
  console.log("VestingManager:  ", await vesting.getAddress());

  const file = writeDeployment(chainId, {
    vestingManager: await vesting.getAddress(),
    mockToken: await token.getAddress(),
    mockPermitToken: await permitToken.getAddress(),
    deployBlock,
  });
  console.log("Direcciones escritas en", file);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
