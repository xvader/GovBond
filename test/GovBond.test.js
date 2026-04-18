const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovBond", function () {
  let usdc, registry, compliance, bond, vault;
  let owner, agent, investor1, investor2, unverified;

  beforeEach(async () => {
    [owner, agent, investor1, investor2, unverified] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    registry = await IdentityRegistry.deploy();

    const ComplianceModule = await ethers.getContractFactory("ComplianceModule");
    compliance = await ComplianceModule.deploy(await registry.getAddress());

    const maturity = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    const GovBondToken = await ethers.getContractFactory("GovBondToken");
    bond = await GovBondToken.deploy(
      await registry.getAddress(),
      await compliance.getAddress(),
      maturity, 750, 0
    );

    await compliance.setBondToken(await bond.getAddress());

    const GovBondVault = await ethers.getContractFactory("GovBondVault");
    vault = await GovBondVault.deploy(await bond.getAddress(), await usdc.getAddress(), 1_000_000n);

    const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AGENT_ROLE"));
    await bond.grantRole(AGENT_ROLE, await vault.getAddress());
    await bond.grantRole(AGENT_ROLE, agent.address);

    // Register investors
    await registry.registerInvestor(owner.address, "ID");
    await registry.registerInvestor(investor1.address, "ID");
    await registry.registerInvestor(investor2.address, "ID");

    // Mint USDC
    await usdc.mint(investor1.address, 10_000n * 1_000_000n);
    await usdc.mint(investor2.address, 10_000n * 1_000_000n);
    await usdc.mint(owner.address, 10_000n * 1_000_000n);
  });

  // 1. Identity Registry
  describe("IdentityRegistry", () => {
    it("registers and verifies investor", async () => {
      expect(await registry.isVerified(investor1.address)).to.be.true;
      expect(await registry.investorCountry(investor1.address)).to.equal("ID");
    });

    it("removes investor", async () => {
      await registry.removeInvestor(investor1.address);
      expect(await registry.isVerified(investor1.address)).to.be.false;
    });

    it("batch registers investors", async () => {
      const [, , , , , a, b] = await ethers.getSigners();
      await registry.batchRegister([a.address, b.address], ["US", "SG"]);
      expect(await registry.isVerified(a.address)).to.be.true;
      expect(await registry.isVerified(b.address)).to.be.true;
    });
  });

  // 2. Bond token minting
  describe("GovBondToken minting", () => {
    it("mints to verified investor", async () => {
      await bond.mint(investor1.address, ethers.parseEther("100"));
      expect(await bond.balanceOf(investor1.address)).to.equal(ethers.parseEther("100"));
    });

    it("reverts mint to unverified investor", async () => {
      await expect(bond.mint(unverified.address, ethers.parseEther("100")))
        .to.be.revertedWith("Recipient not verified");
    });
  });

  // 3. Transfers
  describe("Transfers", () => {
    beforeEach(async () => {
      await bond.mint(investor1.address, ethers.parseEther("100"));
    });

    it("verified → verified succeeds", async () => {
      await bond.connect(investor1).transfer(investor2.address, ethers.parseEther("10"));
      expect(await bond.balanceOf(investor2.address)).to.equal(ethers.parseEther("10"));
    });

    it("verified → unverified reverts", async () => {
      await expect(bond.connect(investor1).transfer(unverified.address, ethers.parseEther("10")))
        .to.be.revertedWith("Compliance check failed");
    });
  });

  // 4. Vault deposit request
  describe("Vault deposit request", () => {
    it("emits DepositRequest_ event", async () => {
      const amount = 1000n * 1_000_000n;
      await usdc.connect(investor1).approve(await vault.getAddress(), amount);
      await expect(vault.connect(investor1).requestDeposit(amount, investor1.address, investor1.address))
        .to.emit(vault, "DepositRequest_");
    });
  });

  // 5. Vault fulfill and claim
  describe("Vault fulfill deposits", () => {
    it("admin fulfills and investor claims bonds", async () => {
      const amount = 1000n * 1_000_000n; // 1000 USDC
      await usdc.connect(investor1).approve(await vault.getAddress(), amount);
      await vault.connect(investor1).requestDeposit(amount, investor1.address, investor1.address);

      await vault.fulfillDeposits([investor1.address]);

      const requestId = await vault.investorDepositRequestId(investor1.address);
      await vault.connect(investor1).deposit(amount, investor1.address, investor1.address);

      // (1000 USDC in 6dec * 1e18) / bondPrice(1e6) = 1000e18 = 1000 bonds
      expect(await bond.balanceOf(investor1.address)).to.equal(ethers.parseEther("1000"));
    });
  });

  // 6. Coupon distribution
  describe("Coupon distribution", () => {
    it("distributes pro-rata coupons", async () => {
      // Deposit via vault so updateHolder fires and _bondholders is populated
      const dep1 = 300n * 1_000_000n;
      const dep2 = 700n * 1_000_000n;

      await usdc.connect(investor1).approve(await vault.getAddress(), dep1);
      await vault.connect(investor1).requestDeposit(dep1, investor1.address, investor1.address);
      await usdc.connect(investor2).approve(await vault.getAddress(), dep2);
      await vault.connect(investor2).requestDeposit(dep2, investor2.address, investor2.address);

      await vault.fulfillDeposits([investor1.address, investor2.address]);
      await vault.connect(investor1).deposit(dep1, investor1.address, investor1.address);
      await vault.connect(investor2).deposit(dep2, investor2.address, investor2.address);

      const couponPool = 1000n * 1_000_000n; // 1000 USDC
      await usdc.connect(owner).approve(await vault.getAddress(), couponPool);

      const i1Before = await usdc.balanceOf(investor1.address);
      const i2Before = await usdc.balanceOf(investor2.address);

      await vault.distributeCoupon(couponPool);

      expect(await usdc.balanceOf(investor1.address)).to.equal(i1Before + 300n * 1_000_000n);
      expect(await usdc.balanceOf(investor2.address)).to.equal(i2Before + 700n * 1_000_000n);
    });
  });

  // 7. Freeze
  describe("Freeze", () => {
    it("frozen address cannot transfer", async () => {
      await bond.mint(investor1.address, ethers.parseEther("100"));
      await bond.freeze(investor1.address, true);
      await expect(bond.connect(investor1).transfer(investor2.address, ethers.parseEther("10")))
        .to.be.revertedWith("Sender frozen");
    });
  });

  // 8. Pause
  describe("Pause", () => {
    it("all transfers revert when paused", async () => {
      await bond.mint(investor1.address, ethers.parseEther("100"));
      await bond.pause();
      await expect(bond.connect(investor1).transfer(investor2.address, ethers.parseEther("10")))
        .to.be.revertedWith("Token paused");
    });
  });
});
