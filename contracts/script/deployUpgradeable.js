// Despliega la variante UUPS: implementacion + proxy ERC-1967 (desafio opcional B).
// `vestingManager` en deployments.json es la direccion del PROXY: es la que usa la dApp y no cambia aunque se
// actualice la implementacion. El owner del proxy es quien ejecuta el script.
//
// Uso local (nodo de `npm run node` en otra terminal):
//   npm run deploy:upgradeable:local
// Para no pisar el deployments.json de la version no upgradeable:
//   DEPLOYMENTS_FILE=../frontend/public/otro.json npm run deploy:upgradeable:local
const { ethers } = require("hardhat");
const { writeDeployment } = require("./lib/writeDeployment");

const TOKEN_DECIMALS = 6;
const INITIAL_MINT = 1_000_000n * 10n ** BigInt(TOKEN_DECIMALS);

async function main() {
  const [deployer] = await ethers.getSigners();

  const token = await ethers.deployContract("MockToken", ["Test USD", "tUSD", TOKEN_DECIMALS]);
  const permitToken = await ethers.deployContract("MockPermitToken", ["Permit USD", "pUSD", TOKEN_DECIMALS]);
  const impl = await ethers.deployContract("VestingManagerUpgradeable");
  const initData = impl.interface.encodeFunctionData("initialize", [deployer.address]);
  const proxy = await ethers.deployContract("ERC1967Proxy", [await impl.getAddress(), initData]);

  await (await token.mint(deployer.address, INITIAL_MINT)).wait();
  await (await permitToken.mint(deployer.address, INITIAL_MINT)).wait();

  const deployBlock = (await proxy.deploymentTransaction().wait()).blockNumber;
  const { chainId } = await ethers.provider.getNetwork();

  console.log("MockToken:        ", await token.getAddress());
  console.log("MockPermitToken:  ", await permitToken.getAddress());
  console.log("Implementacion:   ", await impl.getAddress());
  console.log("Proxy (usar este):", await proxy.getAddress());

  const file = writeDeployment(chainId, {
    vestingManager: await proxy.getAddress(),
    implementation: await impl.getAddress(),
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
