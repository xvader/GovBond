require("dotenv").config();
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const deploymentsPath = path.join(__dirname, "../deployments/arbitrum-sepolia.json");

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("Run deploy.js first — deployments/arbitrum-sepolia.json not found");
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  console.log("Deploying BondFactory with:", deployer.address);

  const BondFactory = await ethers.getContractFactory("BondFactory");
  const factory = await BondFactory.deploy(
    deployments.IDRPToken,
    deployments.IdentityRegistry,
    deployments.ComplianceModule
  );
  await factory.waitForDeployment();
  console.log("BondFactory:", await factory.getAddress());

  const ISSUER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ISSUER_ROLE"));
  await factory.grantRole(ISSUER_ROLE, deployer.address);
  console.log("ISSUER_ROLE granted to deployer");

  deployments.BondFactory = await factory.getAddress();

  const json = JSON.stringify(deployments, null, 2);
  fs.writeFileSync(deploymentsPath, json);
  fs.writeFileSync(path.join(__dirname, "../frontend/deployments.json"), json);
  console.log("Updated deployments with BondFactory address");
}

main().catch((e) => { console.error(e); process.exit(1); });
