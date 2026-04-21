require("dotenv").config();
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. IDRPToken
  const IDRPToken = await ethers.getContractFactory("IDRPToken");
  const idrp = await IDRPToken.deploy();
  await idrp.waitForDeployment();
  console.log("IDRPToken:", await idrp.getAddress());

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
  const maxSupply = 100_000n;
  const faceValueIDRP = 100_000_000n; // Rp 1,000,000.00 at 2 decimals

  const GovBondToken = await ethers.getContractFactory("GovBondToken");
  const bond = await GovBondToken.deploy(
    "Palembang Municipal Bond 2025",
    "PMB25",
    await registry.getAddress(),
    await compliance.getAddress(),
    maturity,
    750,
    maxSupply,
    faceValueIDRP
  );
  await bond.waitForDeployment();
  console.log("GovBondToken:", await bond.getAddress());

  await compliance.setBondToken(await bond.getAddress());

  // 5. GovBondVault
  const GovBondVault = await ethers.getContractFactory("GovBondVault");
  const vault = await GovBondVault.deploy(
    await bond.getAddress(),
    await idrp.getAddress(),
    faceValueIDRP
  );
  await vault.waitForDeployment();
  console.log("GovBondVault:", await vault.getAddress());

  // 6. Grant roles
  const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AGENT_ROLE"));
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await bond.grantRole(AGENT_ROLE, await vault.getAddress());
  await idrp.grantRole(MINTER_ROLE, await vault.getAddress());
  console.log("Roles granted");

  // 7. Register deployer + vault as verified (vault needs KYC to receive bonds in requestRedeem)
  await registry.registerInvestor(deployer.address, "ID");
  await registry.registerInvestor(await vault.getAddress(), "ID");
  console.log("Deployer and vault registered in IdentityRegistry");

  // 8. Mint 10,000,000,000 IDRP (Rp 100,000,000.00) to deployer
  await idrp.mint(deployer.address, 10_000_000_000n);
  console.log("Minted 10,000,000,000 IDRP to deployer");

  // 9. Save deployments
  const deployments = {
    network: "arbitrumSepolia",
    chainId: 421614,
    deployer: deployer.address,
    IDRPToken: await idrp.getAddress(),
    IdentityRegistry: await registry.getAddress(),
    ComplianceModule: await compliance.getAddress(),
    GovBondToken: await bond.getAddress(),
    GovBondVault: await vault.getAddress(),
    maturityDate: maturity,
    deployedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(deployments, null, 2);
  const dir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "arbitrum-sepolia.json"), json);
  fs.writeFileSync(path.join(__dirname, "../frontend/deployments.json"), json);
  console.log("Saved deployments");
}

main().catch((e) => { console.error(e); process.exit(1); });
