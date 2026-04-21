const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovBond", function () {
  let idrp, registry, compliance, bond, vault;
  let owner, agent, investor1, investor2, unverified;

  const FACE_VALUE = 100_000_000n; // Rp 1,000,000.00

  beforeEach(async () => {
    [owner, agent, investor1, investor2, unverified] = await ethers.getSigners();

    const IDRPToken = await ethers.getContractFactory("IDRPToken");
    idrp = await IDRPToken.deploy();

    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    registry = await IdentityRegistry.deploy();

    const ComplianceModule = await ethers.getContractFactory("ComplianceModule");
    compliance = await ComplianceModule.deploy(await registry.getAddress());

    const maturity = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    const GovBondToken = await ethers.getContractFactory("GovBondToken");
    bond = await GovBondToken.deploy(
      "Palembang Municipal Bond 2025", "PMB25",
      await registry.getAddress(),
      await compliance.getAddress(),
      maturity, 750, 100_000n, FACE_VALUE
    );

    await compliance.setBondToken(await bond.getAddress());

    const GovBondVault = await ethers.getContractFactory("GovBondVault");
    vault = await GovBondVault.deploy(await bond.getAddress(), await idrp.getAddress(), FACE_VALUE);

    const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AGENT_ROLE"));
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await bond.grantRole(AGENT_ROLE, await vault.getAddress());
    await bond.grantRole(AGENT_ROLE, agent.address);
    await idrp.grantRole(MINTER_ROLE, await vault.getAddress());

    await registry.registerInvestor(owner.address, "ID");
    await registry.registerInvestor(investor1.address, "ID");
    await registry.registerInvestor(investor2.address, "ID");

    await idrp.mint(investor1.address, FACE_VALUE * 10_000n);
    await idrp.mint(investor2.address, FACE_VALUE * 10_000n);
    await idrp.mint(owner.address, FACE_VALUE * 10_000n);
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
      await bond.mint(investor1.address, 100n);
      expect(await bond.balanceOf(investor1.address)).to.equal(100n);
    });

    it("reverts mint to unverified investor", async () => {
      await expect(bond.mint(unverified.address, 100n))
        .to.be.revertedWith("Recipient not verified");
    });

    it("decimals returns 0", async () => {
      expect(await bond.decimals()).to.equal(0);
    });
  });

  // 3. Transfers
  describe("Transfers", () => {
    beforeEach(async () => {
      await bond.mint(investor1.address, 100n);
    });

    it("verified → verified succeeds", async () => {
      await bond.connect(investor1).transfer(investor2.address, 10n);
      expect(await bond.balanceOf(investor2.address)).to.equal(10n);
    });

    it("verified → unverified reverts", async () => {
      await expect(bond.connect(investor1).transfer(unverified.address, 10n))
        .to.be.revertedWith("Compliance check failed");
    });
  });

  // 4. Vault deposit request
  describe("Vault deposit request", () => {
    it("emits DepositRequest_ event", async () => {
      await idrp.connect(investor1).approve(await vault.getAddress(), FACE_VALUE);
      await expect(vault.connect(investor1).requestDeposit(FACE_VALUE, investor1.address, investor1.address))
        .to.emit(vault, "DepositRequest_");
    });
  });

  // 5. Vault fulfill and claim
  describe("Vault fulfill deposits", () => {
    it("admin fulfills and investor claims bonds", async () => {
      const amount = FACE_VALUE * 1000n; // 1000 bonds
      await idrp.connect(investor1).approve(await vault.getAddress(), amount);
      await vault.connect(investor1).requestDeposit(amount, investor1.address, investor1.address);
      await vault.fulfillDeposits([investor1.address]);
      await vault.connect(investor1).deposit(amount, investor1.address, investor1.address);
      expect(await bond.balanceOf(investor1.address)).to.equal(1000n);
    });
  });

  // 6. Coupon distribution
  describe("Coupon distribution", () => {
    it("distributes pro-rata coupons via vault deposit flow", async () => {
      const dep1 = FACE_VALUE * 300n;
      const dep2 = FACE_VALUE * 700n;

      await idrp.connect(investor1).approve(await vault.getAddress(), dep1);
      await vault.connect(investor1).requestDeposit(dep1, investor1.address, investor1.address);
      await idrp.connect(investor2).approve(await vault.getAddress(), dep2);
      await vault.connect(investor2).requestDeposit(dep2, investor2.address, investor2.address);

      await vault.fulfillDeposits([investor1.address, investor2.address]);
      await vault.connect(investor1).deposit(dep1, investor1.address, investor1.address);
      await vault.connect(investor2).deposit(dep2, investor2.address, investor2.address);

      const couponPool = FACE_VALUE * 1000n;
      await idrp.connect(owner).approve(await vault.getAddress(), couponPool);

      const i1Before = await idrp.balanceOf(investor1.address);
      const i2Before = await idrp.balanceOf(investor2.address);

      await vault.distributeCoupon(couponPool);

      expect(await idrp.balanceOf(investor1.address)).to.equal(i1Before + FACE_VALUE * 300n);
      expect(await idrp.balanceOf(investor2.address)).to.equal(i2Before + FACE_VALUE * 700n);
    });
  });

  // 7. Freeze
  describe("Freeze", () => {
    it("frozen address cannot transfer", async () => {
      await bond.mint(investor1.address, 100n);
      await bond.freeze(investor1.address, true);
      await expect(bond.connect(investor1).transfer(investor2.address, 10n))
        .to.be.revertedWith("Sender frozen");
    });
  });

  // 8. Pause
  describe("Pause", () => {
    it("all transfers revert when paused", async () => {
      await bond.mint(investor1.address, 100n);
      await bond.pause();
      await expect(bond.connect(investor1).transfer(investor2.address, 10n))
        .to.be.revertedWith("Token paused");
    });
  });
});
