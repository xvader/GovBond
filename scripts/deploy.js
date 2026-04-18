require("dotenv").config();
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  console.log("MockUSDC:", await usdc.getAddress());

  // 2. IdentityRegistry
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const registry = await IdentityRegistry.deploy();
  await registry.waitForDeployment();
  console.log("IdentityRegistry:", await registry.getAddress());

  // 3. ComplianceModule
  const ComplianceModule = await ethers.getContractFactory("ComplianceModule");
  const compliance = await ComplianceModule.deploy(await registry.getAddress());
  await compliance.waitForDeployment();
  console.log("ComplianceModule:", await compliance.getAddress());

  // 4. GovBondToken
  const maturity = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const GovBondToken = await ethers.getContractFactory("GovBondToken");
  const bond = await GovBondToken.deploy(
    await registry.getAddress(),
    await compliance.getAddress(),
    maturity,
    750,
    0
  );
  await bond.waitForDeployment();
  console.log("GovBondToken:", await bond.getAddress());

  // Wire compliance → bond token
  await compliance.setBondToken(await bond.getAddress());

  // 5. GovBondVault (bondPrice = 1 USDC = 1e6)
  const GovBondVault = await ethers.getContractFactory("GovBondVault");
  const vault = await GovBondVault.deploy(
    await bond.getAddress(),
    await usdc.getAddress(),
    1_000_000n // 1 USDC per bond unit
  );
  await vault.waitForDeployment();
  console.log("GovBondVault:", await vault.getAddress());

  // 6. Grant AGENT_ROLE to deployer and vault on bond token
  const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AGENT_ROLE"));
  await bond.grantRole(AGENT_ROLE, await vault.getAddress());
  console.log("AGENT_ROLE granted to vault");

  // 7. Register deployer as verified investor
  await registry.registerInvestor(deployer.address, "ID");
  console.log("Deployer registered as investor");

  // 8. Mint 1,000,000 USDC to deployer
  await usdc.mint(deployer.address, 1_000_000n * 1_000_000n); // 1M USDC (6 decimals)
  console.log("Minted 1,000,000 USDC to deployer");

  // 9. Save addresses
  const deployments = {
    network: "arbitrumSepolia",
    chainId: 421614,
    deployer: deployer.address,
    MockUSDC: await usdc.getAddress(),
    IdentityRegistry: await registry.getAddress(),
    ComplianceModule: await compliance.getAddress(),
    GovBondToken: await bond.getAddress(),
    GovBondVault: await vault.getAddress(),
    maturityDate: maturity,
    deployedAt: new Date().toISOString(),
  };

  const dir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const json = JSON.stringify(deployments, null, 2);
  fs.writeFileSync(path.join(dir, "arbitrum-sepolia.json"), json);
  fs.writeFileSync(path.join(__dirname, "../frontend/deployments.json"), json);
  console.log("Saved to deployments/arbitrum-sepolia.json and frontend/deployments.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
