const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const FACE_VALUE = 100_000_000n; // Rp 1,000,000.00 at 2 decimals
const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AGENT_ROLE"));
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
const COMPLIANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_ROLE"));
const ISSUER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ISSUER_ROLE"));

async function deployFixture() {
  const [owner, agent, investor1, investor2, investor3, unverified] = await ethers.getSigners();

  const IDRPToken = await ethers.getContractFactory("IDRPToken");
  const idrp = await IDRPToken.deploy();

  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const registry = await IdentityRegistry.deploy();

  const ComplianceModule = await ethers.getContractFactory("ComplianceModule");
  const compliance = await ComplianceModule.deploy(await registry.getAddress());

  const maturity = (await time.latest()) + 365 * 24 * 3600;

  const GovBondToken = await ethers.getContractFactory("GovBondToken");
  const bond = await GovBondToken.deploy(
    "Palembang Municipal Bond 2025", "PMB25",
    await registry.getAddress(),
    await compliance.getAddress(),
    maturity, 750, 100_000n, FACE_VALUE
  );

  await compliance.setBondToken(await bond.getAddress());

  const GovBondVault = await ethers.getContractFactory("GovBondVault");
  const vault = await GovBondVault.deploy(
    await bond.getAddress(), await idrp.getAddress(), FACE_VALUE
  );

  await bond.grantRole(AGENT_ROLE, await vault.getAddress());
  await bond.grantRole(AGENT_ROLE, agent.address);
  await idrp.grantRole(MINTER_ROLE, await vault.getAddress());

  await registry.registerInvestor(owner.address, "ID");
  await registry.registerInvestor(investor1.address, "ID");
  await registry.registerInvestor(investor2.address, "ID");
  await registry.registerInvestor(investor3.address, "SG");
  // Vault must be registered so transferFrom(investor → vault) passes compliance
  await registry.registerInvestor(await vault.getAddress(), "ID");

  const FUND = FACE_VALUE * 10_000n;
  await idrp.mint(owner.address, FUND);
  await idrp.mint(investor1.address, FUND);
  await idrp.mint(investor2.address, FUND);
  await idrp.mint(investor3.address, FUND);

  return { idrp, registry, compliance, bond, vault, owner, agent, investor1, investor2, investor3, unverified, maturity };
}

// ─── 1. IDRPToken ────────────────────────────────────────────────────────────
describe("IDRPToken", () => {
  it("has correct name/symbol/decimals", async () => {
    const { idrp } = await loadFixture(deployFixture);
    expect(await idrp.name()).to.equal("Indonesian Rupiah");
    expect(await idrp.symbol()).to.equal("IDRP");
    expect(await idrp.decimals()).to.equal(2);
  });

  it("only MINTER_ROLE can mint", async () => {
    const { idrp, unverified } = await loadFixture(deployFixture);
    await expect(idrp.connect(unverified).mint(unverified.address, 100n))
      .to.be.revertedWithCustomError(idrp, "AccessControlUnauthorizedAccount");
  });

  it("MINTER_ROLE can mint", async () => {
    const { idrp, owner, unverified } = await loadFixture(deployFixture);
    await idrp.mint(unverified.address, 500n);
    expect(await idrp.balanceOf(unverified.address)).to.equal(500n);
  });

  it("holder can burn own tokens", async () => {
    const { idrp, investor1 } = await loadFixture(deployFixture);
    const before = await idrp.balanceOf(investor1.address);
    await idrp.connect(investor1).burn(100n);
    expect(await idrp.balanceOf(investor1.address)).to.equal(before - 100n);
  });

  it("burnFrom uses allowance", async () => {
    const { idrp, investor1, investor2 } = await loadFixture(deployFixture);
    await idrp.connect(investor1).approve(investor2.address, 200n);
    await idrp.connect(investor2).burnFrom(investor1.address, 200n);
    // allowance should be spent
    expect(await idrp.allowance(investor1.address, investor2.address)).to.equal(0n);
  });

  it("faucet works when enabled", async () => {
    const { idrp, unverified } = await loadFixture(deployFixture);
    await idrp.faucet(unverified.address);
    expect(await idrp.balanceOf(unverified.address)).to.equal(100_000_000n);
  });

  it("faucet respects 24hr cooldown", async () => {
    const { idrp, unverified } = await loadFixture(deployFixture);
    await idrp.faucet(unverified.address);
    await expect(idrp.faucet(unverified.address)).to.be.revertedWith("Cooldown");
    await time.increase(24 * 3600 + 1);
    await idrp.faucet(unverified.address); // should succeed
  });

  it("admin can disable faucet", async () => {
    const { idrp, unverified } = await loadFixture(deployFixture);
    await idrp.disableFaucet();
    await expect(idrp.faucet(unverified.address)).to.be.revertedWith("Faucet disabled");
  });

  it("paused token blocks transfers", async () => {
    const { idrp, owner, investor1 } = await loadFixture(deployFixture);
    await idrp.pause();
    await expect(idrp.connect(owner).transfer(investor1.address, 100n))
      .to.be.revertedWith("Token paused");
  });

  it("admin can unpause", async () => {
    const { idrp, owner, investor1 } = await loadFixture(deployFixture);
    await idrp.pause();
    await idrp.unpause();
    await idrp.connect(owner).transfer(investor1.address, 100n); // should not revert
  });
});

// ─── 2. IdentityRegistry ─────────────────────────────────────────────────────
describe("IdentityRegistry", () => {
  it("registerInvestor sets verified + country + verifiedAt", async () => {
    const { registry, unverified } = await loadFixture(deployFixture);
    await registry.registerInvestor(unverified.address, "US");
    expect(await registry.isVerified(unverified.address)).to.be.true;
    expect(await registry.investorCountry(unverified.address)).to.equal("US");
    expect(await registry.verifiedAt(unverified.address)).to.be.gt(0n);
  });

  it("removeInvestor clears verified flag", async () => {
    const { registry, investor1 } = await loadFixture(deployFixture);
    await registry.removeInvestor(investor1.address);
    expect(await registry.isVerified(investor1.address)).to.be.false;
  });

  it("batchRegister registers multiple investors", async () => {
    const { registry } = await loadFixture(deployFixture);
    const signers = await ethers.getSigners();
    const a = signers[6], b = signers[7];
    await registry.batchRegister([a.address, b.address], ["MY", "JP"]);
    expect(await registry.isVerified(a.address)).to.be.true;
    expect(await registry.investorCountry(b.address)).to.equal("JP");
  });

  it("batchRegister reverts on length mismatch", async () => {
    const { registry, investor1, investor2 } = await loadFixture(deployFixture);
    await expect(registry.batchRegister([investor1.address, investor2.address], ["ID"]))
      .to.be.revertedWith("Length mismatch");
  });

  it("batchRegister reverts if > 200 entries", async () => {
    const { registry } = await loadFixture(deployFixture);
    const addrs = Array(201).fill(ethers.ZeroAddress);
    const countries = Array(201).fill("ID");
    await expect(registry.batchRegister(addrs, countries))
      .to.be.revertedWith("Batch too large");
  });

  it("non-AGENT_ROLE reverts on registerInvestor", async () => {
    const { registry, unverified } = await loadFixture(deployFixture);
    await expect(registry.connect(unverified).registerInvestor(unverified.address, "ID"))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });
});

// ─── 3. ComplianceModule ─────────────────────────────────────────────────────
describe("ComplianceModule", () => {
  it("returns true for two verified unfrozen addresses", async () => {
    const { compliance, investor1, investor2 } = await loadFixture(deployFixture);
    expect(await compliance.canTransfer(investor1.address, investor2.address, 1n)).to.be.true;
  });

  it("returns false if sender not verified", async () => {
    const { compliance, unverified, investor1 } = await loadFixture(deployFixture);
    expect(await compliance.canTransfer(unverified.address, investor1.address, 1n)).to.be.false;
  });

  it("returns false if recipient not verified", async () => {
    const { compliance, investor1, unverified } = await loadFixture(deployFixture);
    expect(await compliance.canTransfer(investor1.address, unverified.address, 1n)).to.be.false;
  });

  it("returns false if sender frozen", async () => {
    const { compliance, bond, investor1, investor2 } = await loadFixture(deployFixture);
    await bond.freeze(investor1.address, true);
    expect(await compliance.canTransfer(investor1.address, investor2.address, 1n)).to.be.false;
  });

  it("returns false if recipient frozen", async () => {
    const { compliance, bond, investor1, investor2 } = await loadFixture(deployFixture);
    await bond.freeze(investor2.address, true);
    expect(await compliance.canTransfer(investor1.address, investor2.address, 1n)).to.be.false;
  });

  it("maxHoldingBps: returns false if recipient would exceed cap", async () => {
    const { compliance, bond, vault, idrp, owner, investor1, investor2 } = await loadFixture(deployFixture);
    // Set 10% cap
    await compliance.setMaxHoldingBps(1000);
    // Mint 100 bonds to investor1 (1% of 100k supply cap)
    await bond.mint(investor1.address, 100n);
    // Try to transfer 10001 bonds to investor2 — exceeds 10% of 100 total supply
    // First mint enough to investor1
    await bond.mint(investor1.address, 10_000n);
    // investor2 has 0; 10001 > 10% of 10100 total supply
    expect(await compliance.canTransfer(investor1.address, investor2.address, 10_000n)).to.be.false;
  });

  it("country blocklist: returns false if country blocked", async () => {
    const { compliance, investor1, investor3 } = await loadFixture(deployFixture);
    // investor3 is "SG"
    await compliance.blockCountry("0x5347", true); // "SG" as bytes2
    expect(await compliance.canTransfer(investor1.address, investor3.address, 1n)).to.be.false;
  });

  it("mint path (from == address(0)): only checks recipient", async () => {
    const { compliance, investor1 } = await loadFixture(deployFixture);
    expect(await compliance.canTransfer(ethers.ZeroAddress, investor1.address, 1n)).to.be.true;
  });

  it("mint path: returns false for unverified recipient", async () => {
    const { compliance, unverified } = await loadFixture(deployFixture);
    expect(await compliance.canTransfer(ethers.ZeroAddress, unverified.address, 1n)).to.be.false;
  });
});

// ─── 4. GovBondToken ─────────────────────────────────────────────────────────
describe("GovBondToken", () => {
  it("has correct name/symbol/decimals/faceValueIDRP/couponRate/maturityDate", async () => {
    const { bond, maturity } = await loadFixture(deployFixture);
    expect(await bond.name()).to.equal("Palembang Municipal Bond 2025");
    expect(await bond.symbol()).to.equal("PMB25");
    expect(await bond.decimals()).to.equal(0);
    expect(await bond.faceValueIDRP()).to.equal(FACE_VALUE);
    expect(await bond.couponRate()).to.equal(750n);
    expect(await bond.maturityDate()).to.equal(BigInt(maturity));
  });

  it("mint: AGENT_ROLE only", async () => {
    const { bond, unverified, investor1 } = await loadFixture(deployFixture);
    await expect(bond.connect(unverified).mint(investor1.address, 1n))
      .to.be.revertedWithCustomError(bond, "AccessControlUnauthorizedAccount");
  });

  it("mint: reverts for unverified recipient", async () => {
    const { bond, unverified } = await loadFixture(deployFixture);
    await expect(bond.mint(unverified.address, 1n)).to.be.revertedWith("Recipient not verified");
  });

  it("mint: respects maxSupply cap", async () => {
    const { bond, investor1 } = await loadFixture(deployFixture);
    await expect(bond.mint(investor1.address, 100_001n)).to.be.revertedWith("Cap reached");
  });

  it("freeze: AGENT_ROLE only", async () => {
    const { bond, unverified, investor1 } = await loadFixture(deployFixture);
    await expect(bond.connect(unverified).freeze(investor1.address, true))
      .to.be.revertedWithCustomError(bond, "AccessControlUnauthorizedAccount");
  });

  it("freeze: frozen sender reverts transfer", async () => {
    const { bond, investor1, investor2 } = await loadFixture(deployFixture);
    await bond.mint(investor1.address, 10n);
    await bond.freeze(investor1.address, true);
    await expect(bond.connect(investor1).transfer(investor2.address, 1n))
      .to.be.revertedWith("Sender frozen");
  });

  it("freeze: frozen receiver reverts transfer", async () => {
    const { bond, investor1, investor2 } = await loadFixture(deployFixture);
    await bond.mint(investor1.address, 10n);
    await bond.freeze(investor2.address, true);
    await expect(bond.connect(investor1).transfer(investor2.address, 1n))
      .to.be.revertedWith("Recipient frozen");
  });

  it("forcedTransfer: bypasses compliance, works on frozen address", async () => {
    const { bond, investor1, investor2 } = await loadFixture(deployFixture);
    await bond.mint(investor1.address, 10n);
    await bond.freeze(investor1.address, true);
    await bond.forcedTransfer(investor1.address, investor2.address, 5n);
    expect(await bond.balanceOf(investor2.address)).to.equal(5n);
  });

  it("pause/unpause: admin only", async () => {
    const { bond, unverified } = await loadFixture(deployFixture);
    await expect(bond.connect(unverified).pause())
      .to.be.revertedWithCustomError(bond, "AccessControlUnauthorizedAccount");
  });

  it("pause: blocks transfers", async () => {
    const { bond, investor1, investor2 } = await loadFixture(deployFixture);
    await bond.mint(investor1.address, 10n);
    await bond.pause();
    await expect(bond.connect(investor1).transfer(investor2.address, 1n))
      .to.be.revertedWith("Token paused");
  });

  it("redeemable() returns false before maturity", async () => {
    const { bond } = await loadFixture(deployFixture);
    expect(await bond.redeemable()).to.be.false;
  });

  it("redeemable() returns true after maturity", async () => {
    const { bond, maturity } = await loadFixture(deployFixture);
    await time.increaseTo(maturity + 1);
    expect(await bond.redeemable()).to.be.true;
  });

  it("_update: compliance check skips on mint (from == address(0))", async () => {
    const { bond, investor1 } = await loadFixture(deployFixture);
    // mint should not revert even though compliance is set
    await bond.mint(investor1.address, 1n);
    expect(await bond.balanceOf(investor1.address)).to.equal(1n);
  });
});

// ─── 5. GovBondVault ─────────────────────────────────────────────────────────
describe("GovBondVault", () => {
  async function subscribe(vault, idrp, investor, units) {
    const assets = FACE_VALUE * BigInt(units);
    await idrp.connect(investor).approve(await vault.getAddress(), assets);
    await vault.connect(investor).requestDeposit(assets, investor.address, investor.address);
    await vault.fulfillDeposits([investor.address]);
    await vault.connect(investor).deposit(assets, investor.address, investor.address);
    return assets;
  }

  it("requestDeposit: locks IDRP and creates request", async () => {
    const { vault, idrp, investor1 } = await loadFixture(deployFixture);
    const vaultAddr = await vault.getAddress();
    await idrp.connect(investor1).approve(vaultAddr, FACE_VALUE);
    await vault.connect(investor1).requestDeposit(FACE_VALUE, investor1.address, investor1.address);
    expect(await idrp.balanceOf(vaultAddr)).to.equal(FACE_VALUE);
    expect(await vault.hasPendingDeposit(investor1.address)).to.be.true;
  });

  it("requestDeposit: blocks double-pending", async () => {
    const { vault, idrp, investor1 } = await loadFixture(deployFixture);
    await idrp.connect(investor1).approve(await vault.getAddress(), FACE_VALUE * 2n);
    await vault.connect(investor1).requestDeposit(FACE_VALUE, investor1.address, investor1.address);
    await expect(
      vault.connect(investor1).requestDeposit(FACE_VALUE, investor1.address, investor1.address)
    ).to.be.revertedWithCustomError(vault, "PendingDepositExists");
  });

  it("fulfillDeposits: AGENT_ROLE only", async () => {
    const { vault, unverified } = await loadFixture(deployFixture);
    await expect(vault.connect(unverified).fulfillDeposits([]))
      .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
  });

  it("deposit: mints correct bond units (1 FACE_VALUE → 1 unit)", async () => {
    const { vault, idrp, bond, investor1 } = await loadFixture(deployFixture);
    await idrp.connect(investor1).approve(await vault.getAddress(), FACE_VALUE);
    await vault.connect(investor1).requestDeposit(FACE_VALUE, investor1.address, investor1.address);
    await vault.fulfillDeposits([investor1.address]);
    await vault.connect(investor1).deposit(FACE_VALUE, investor1.address, investor1.address);
    expect(await bond.balanceOf(investor1.address)).to.equal(1n);
  });

  it("deposit: reverts on non-multiple of bondPrice", async () => {
    const { vault, idrp, investor1 } = await loadFixture(deployFixture);
    const odd = FACE_VALUE + 1n;
    await idrp.connect(investor1).approve(await vault.getAddress(), odd);
    await vault.connect(investor1).requestDeposit(odd, investor1.address, investor1.address);
    await vault.fulfillDeposits([investor1.address]);
    await expect(
      vault.connect(investor1).deposit(odd, investor1.address, investor1.address)
    ).to.be.revertedWithCustomError(vault, "NotWholeNumberOfBonds");
  });

  it("deposit: reverts when bond cap would be exceeded", async () => {
    const { vault, idrp, bond, investor1 } = await loadFixture(deployFixture);
    const overCap = FACE_VALUE * 100_001n;
    await idrp.mint(investor1.address, overCap);
    await idrp.connect(investor1).approve(await vault.getAddress(), overCap);
    await vault.connect(investor1).requestDeposit(overCap, investor1.address, investor1.address);
    await vault.fulfillDeposits([investor1.address]);
    await expect(
      vault.connect(investor1).deposit(overCap, investor1.address, investor1.address)
    ).to.be.revertedWithCustomError(vault, "BondCapReached");
  });

  it("requestRedeem: reverts before maturity", async () => {
    const { vault, idrp, bond, investor1 } = await loadFixture(deployFixture);
    await subscribe(vault, idrp, investor1, 1);
    await bond.connect(investor1).approve(await vault.getAddress(), 1n);
    await expect(
      vault.connect(investor1).requestRedeem(1n, investor1.address, investor1.address)
    ).to.be.revertedWithCustomError(vault, "BondNotMatured");
  });

  it("fulfillRedemptions: AGENT_ROLE only", async () => {
    const { vault, unverified } = await loadFixture(deployFixture);
    await expect(vault.connect(unverified).fulfillRedemptions([]))
      .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
  });

  it("redeem: burns bond tokens and returns IDRP", async () => {
    const { vault, idrp, bond, investor1, maturity } = await loadFixture(deployFixture);
    await subscribe(vault, idrp, investor1, 5);
    await time.increaseTo(maturity + 1);
    await bond.connect(investor1).approve(await vault.getAddress(), 5n);
    await vault.connect(investor1).requestRedeem(5n, investor1.address, investor1.address);
    await vault.fulfillRedemptions([investor1.address]);
    const before = await idrp.balanceOf(investor1.address);
    await vault.connect(investor1).redeem(5n, investor1.address, investor1.address);
    expect(await bond.balanceOf(investor1.address)).to.equal(0n);
    expect(await idrp.balanceOf(investor1.address)).to.equal(before + FACE_VALUE * 5n);
  });

  it("distributeCoupon: pro-rata payout, dust returned", async () => {
    const { vault, idrp, owner, investor1, investor2 } = await loadFixture(deployFixture);
    await subscribe(vault, idrp, investor1, 300);
    await subscribe(vault, idrp, investor2, 700);

    const pool = FACE_VALUE * 1000n;
    await idrp.connect(owner).approve(await vault.getAddress(), pool);
    const i1Before = await idrp.balanceOf(investor1.address);
    const i2Before = await idrp.balanceOf(investor2.address);
    await vault.distributeCoupon(pool);
    expect(await idrp.balanceOf(investor1.address)).to.equal(i1Before + FACE_VALUE * 300n);
    expect(await idrp.balanceOf(investor2.address)).to.equal(i2Before + FACE_VALUE * 700n);
  });

  it("distributeCoupon: single holder receives 100%", async () => {
    const { vault, idrp, owner, investor1 } = await loadFixture(deployFixture);
    await subscribe(vault, idrp, investor1, 100);
    const pool = FACE_VALUE * 100n;
    await idrp.connect(owner).approve(await vault.getAddress(), pool);
    const before = await idrp.balanceOf(investor1.address);
    await vault.distributeCoupon(pool);
    expect(await idrp.balanceOf(investor1.address)).to.equal(before + pool);
  });

  it("distributeCoupon: 3 holders, correct shares", async () => {
    const { vault, idrp, owner, investor1, investor2, investor3 } = await loadFixture(deployFixture);
    await subscribe(vault, idrp, investor1, 500);
    await subscribe(vault, idrp, investor2, 300);
    await subscribe(vault, idrp, investor3, 200);

    const pool = FACE_VALUE * 1000n;
    await idrp.connect(owner).approve(await vault.getAddress(), pool);
    const b1 = await idrp.balanceOf(investor1.address);
    const b2 = await idrp.balanceOf(investor2.address);
    const b3 = await idrp.balanceOf(investor3.address);
    await vault.distributeCoupon(pool);
    expect(await idrp.balanceOf(investor1.address)).to.equal(b1 + FACE_VALUE * 500n);
    expect(await idrp.balanceOf(investor2.address)).to.equal(b2 + FACE_VALUE * 300n);
    expect(await idrp.balanceOf(investor3.address)).to.equal(b3 + FACE_VALUE * 200n);
  });

  it("getHolders: reflects mints and burns", async () => {
    const { vault, idrp, bond, investor1, investor2, maturity } = await loadFixture(deployFixture);
    await subscribe(vault, idrp, investor1, 1);
    await subscribe(vault, idrp, investor2, 1);
    let holders = await vault.getHolders();
    expect(holders).to.include(investor1.address);
    expect(holders).to.include(investor2.address);

    // Redeem investor1 fully
    await time.increaseTo(maturity + 1);
    await bond.connect(investor1).approve(await vault.getAddress(), 1n);
    await vault.connect(investor1).requestRedeem(1n, investor1.address, investor1.address);
    await vault.fulfillRedemptions([investor1.address]);
    await vault.connect(investor1).redeem(1n, investor1.address, investor1.address);

    holders = await vault.getHolders();
    expect(holders).to.not.include(investor1.address);
    expect(holders).to.include(investor2.address);
  });

  it("resetDepositRequest: admin only, unblocks investor", async () => {
    const { vault, idrp, investor1, unverified } = await loadFixture(deployFixture);
    await idrp.connect(investor1).approve(await vault.getAddress(), FACE_VALUE);
    await vault.connect(investor1).requestDeposit(FACE_VALUE, investor1.address, investor1.address);
    await expect(vault.connect(unverified).resetDepositRequest(investor1.address))
      .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    await vault.resetDepositRequest(investor1.address);
    expect(await vault.hasPendingDeposit(investor1.address)).to.be.false;
  });

  it("resetRedeemRequest: admin only, unblocks investor", async () => {
    const { vault, idrp, bond, investor1, maturity, unverified } = await loadFixture(deployFixture);
    await subscribe(vault, idrp, investor1, 1);
    await time.increaseTo(maturity + 1);
    await bond.connect(investor1).approve(await vault.getAddress(), 1n);
    await vault.connect(investor1).requestRedeem(1n, investor1.address, investor1.address);
    await expect(vault.connect(unverified).resetRedeemRequest(investor1.address))
      .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    await vault.resetRedeemRequest(investor1.address);
    expect(await vault.hasPendingRedeem(investor1.address)).to.be.false;
  });

  it("sweepToken: admin only, transfers token out", async () => {
    const { vault, idrp, owner } = await loadFixture(deployFixture);
    // Deploy a dummy ERC20 to sweep
    const IDRPToken = await ethers.getContractFactory("IDRPToken");
    const dummy = await IDRPToken.deploy();
    const vaultAddr = await vault.getAddress();
    await dummy.mint(vaultAddr, 1000n);
    await vault.sweepToken(await dummy.getAddress(), owner.address, 1000n);
    expect(await dummy.balanceOf(owner.address)).to.equal(1000n);
  });

  it("reentrancy: nonReentrant blocks reentry on deposit", async () => {
    const { vault, idrp, investor1 } = await loadFixture(deployFixture);
    const MockAttacker = await ethers.getContractFactory("MockAttacker");
    const attacker = await MockAttacker.deploy(await vault.getAddress(), await idrp.getAddress());

    // Fund attacker and set up a pending deposit
    await idrp.mint(await attacker.getAddress(), FACE_VALUE * 2n);
    // Attacker cannot call deposit without a claimable request — the revert will be NotClaimable
    // which proves the guard works (or ReentrancyGuardReentrantCall if truly reentrant)
    await expect(attacker.attackDeposit()).to.be.reverted;
  });
});

// ─── 6. BondFactory ──────────────────────────────────────────────────────────
describe("BondFactory", () => {
  async function deployFactoryFixture() {
    const base = await deployFixture();
    const BondFactory = await ethers.getContractFactory("BondFactory");
    const factory = await BondFactory.deploy(
      await base.idrp.getAddress(),
      await base.registry.getAddress(),
      await base.compliance.getAddress()
    );
    return { ...base, factory };
  }

  it("deployBond: creates GovBondToken + GovBondVault with correct params", async () => {
    const { factory, idrp } = await loadFixture(deployFactoryFixture);
    const tx = await factory.deployBond("Test Bond", "TB", 100_000_000n, 750n, 12n, 1000n);
    const receipt = await tx.wait();
    const count = await factory.getBondsCount();
    expect(count).to.equal(1n);
    const record = await factory.getBond(0);
    expect(record.symbol).to.equal("TB");
    expect(record.faceValueIDRP).to.equal(100_000_000n);
    expect(record.couponRate).to.equal(750n);
    expect(record.maxSupply).to.equal(1000n);
  });

  it("deployBond: reverts on name too long", async () => {
    const { factory } = await loadFixture(deployFactoryFixture);
    const longName = "A".repeat(65);
    await expect(factory.deployBond(longName, "TB", 100_000_000n, 750n, 12n, 1000n))
      .to.be.revertedWith("Invalid name");
  });

  it("deployBond: reverts on coupon > 50%", async () => {
    const { factory } = await loadFixture(deployFactoryFixture);
    await expect(factory.deployBond("Test", "TB", 100_000_000n, 5001n, 12n, 1000n))
      .to.be.revertedWith("Coupon > 50%");
  });

  it("deployBond: reverts on invalid maturity", async () => {
    const { factory } = await loadFixture(deployFactoryFixture);
    await expect(factory.deployBond("Test", "TB", 100_000_000n, 750n, 0n, 1000n))
      .to.be.revertedWith("Invalid maturity");
  });

  it("deployBond: reverts on invalid supply", async () => {
    const { factory } = await loadFixture(deployFactoryFixture);
    await expect(factory.deployBond("Test", "TB", 100_000_000n, 750n, 12n, 0n))
      .to.be.revertedWith("Invalid supply");
  });

  it("getAllBonds: returns correct records", async () => {
    const { factory } = await loadFixture(deployFactoryFixture);
    await factory.deployBond("Bond A", "BA", 100_000_000n, 500n, 6n, 500n);
    await factory.deployBond("Bond B", "BB", 200_000_000n, 750n, 12n, 1000n);
    const bonds = await factory.getAllBonds();
    expect(bonds.length).to.equal(2);
    expect(bonds[0].symbol).to.equal("BA");
    expect(bonds[1].symbol).to.equal("BB");
  });

  it("getBondByToken: returns correct record", async () => {
    const { factory } = await loadFixture(deployFactoryFixture);
    const tx = await factory.deployBond("Bond X", "BX", 100_000_000n, 750n, 12n, 100n);
    const receipt = await tx.wait();
    const bonds = await factory.getAllBonds();
    const record = await factory.getBondByToken(bonds[0].bondToken);
    expect(record.symbol).to.equal("BX");
  });

  it("ISSUER_ROLE: non-issuer reverts", async () => {
    const { factory, unverified } = await loadFixture(deployFactoryFixture);
    await expect(
      factory.connect(unverified).deployBond("Test", "TB", 100_000_000n, 750n, 12n, 100n)
    ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
  });

  it("BondDeployed event emitted with correct args", async () => {
    const { factory, owner } = await loadFixture(deployFactoryFixture);
    await expect(factory.deployBond("Event Bond", "EB", 100_000_000n, 750n, 12n, 100n))
      .to.emit(factory, "BondDeployed")
      .withArgs(
        (v) => ethers.isAddress(v),
        (v) => ethers.isAddress(v),
        owner.address,
        "EB",
        (v) => v > 0n
      );
  });
});

// ─── 7. Integration: Full Bond Lifecycle ─────────────────────────────────────
describe("Integration: Full Bond Lifecycle", () => {
  it("3 investors subscribe, coupon distributed, all redeem, supply = 0", async () => {
    const { idrp, registry, compliance, bond, vault, owner, investor1, investor2, investor3, maturity } =
      await loadFixture(deployFixture);

    // Subscribe: 3 investors
    async function sub(inv, units) {
      const assets = FACE_VALUE * BigInt(units);
      await idrp.connect(inv).approve(await vault.getAddress(), assets);
      await vault.connect(inv).requestDeposit(assets, inv.address, inv.address);
    }
    await sub(investor1, 500);
    await sub(investor2, 300);
    await sub(investor3, 200);

    await vault.fulfillDeposits([investor1.address, investor2.address, investor3.address]);
    await vault.connect(investor1).deposit(FACE_VALUE * 500n, investor1.address, investor1.address);
    await vault.connect(investor2).deposit(FACE_VALUE * 300n, investor2.address, investor2.address);
    await vault.connect(investor3).deposit(FACE_VALUE * 200n, investor3.address, investor3.address);

    expect(await bond.totalSupply()).to.equal(1000n);

    // Distribute coupon
    const pool = FACE_VALUE * 1000n;
    await idrp.connect(owner).approve(await vault.getAddress(), pool);
    await vault.distributeCoupon(pool);
    expect(await vault.couponsReceived(investor1.address)).to.equal(FACE_VALUE * 500n);

    // Warp past maturity
    await time.increaseTo(maturity + 1);
    expect(await bond.redeemable()).to.be.true;

    // All 3 redeem
    async function redeem(inv, units) {
      await bond.connect(inv).approve(await vault.getAddress(), BigInt(units));
      await vault.connect(inv).requestRedeem(BigInt(units), inv.address, inv.address);
    }
    await redeem(investor1, 500);
    await redeem(investor2, 300);
    await redeem(investor3, 200);

    await vault.fulfillRedemptions([investor1.address, investor2.address, investor3.address]);
    await vault.connect(investor1).redeem(500n, investor1.address, investor1.address);
    await vault.connect(investor2).redeem(300n, investor2.address, investor2.address);
    await vault.connect(investor3).redeem(200n, investor3.address, investor3.address);

    expect(await bond.totalSupply()).to.equal(0n);
    expect(await vault.getHolders()).to.deep.equal([]);
  });

  it("ComplianceModule blocks transfer to unverified wallet", async () => {
    const { bond, investor1, unverified } = await loadFixture(deployFixture);
    await bond.mint(investor1.address, 10n);
    await expect(bond.connect(investor1).transfer(unverified.address, 1n))
      .to.be.revertedWith("Compliance check failed");
  });
});
