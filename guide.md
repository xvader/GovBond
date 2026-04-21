# GovBond — Comprehensive Deployment & Operations Guide

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Setup](#2-project-setup)
3. [Environment Configuration](#3-environment-configuration)
4. [Compile & Test](#4-compile--test)
5. [Deploy to Arbitrum Sepolia](#5-deploy-to-arbitrum-sepolia)
6. [Post-Deployment Setup](#6-post-deployment-setup)
7. [Running the Frontend](#7-running-the-frontend)
8. [Using the Admin Dashboard](#8-using-the-admin-dashboard)
9. [Using the Issuer Portal](#9-using-the-issuer-portal)
10. [Using the Investor Portal](#10-using-the-investor-portal)
11. [Bond Lifecycle Walkthrough](#11-bond-lifecycle-walkthrough)
12. [Local Development](#12-local-development)
13. [Contract Verification](#13-contract-verification)
14. [Merging & Tagging a Release](#14-merging--tagging-a-release)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | `node --version` |
| npm | 8+ | comes with Node |
| Git | any | for version control |
| MetaMask | latest | browser extension |
| Arbitrum Sepolia ETH | any amount | for gas |

**Get testnet ETH:**
- https://faucet.triangleplatform.com/arbitrum/sepolia
- https://www.alchemy.com/faucets/arbitrum-sepolia

**Add Arbitrum Sepolia to MetaMask:**

| Field | Value |
|---|---|
| Network Name | Arbitrum Sepolia |
| RPC URL | https://sepolia-rollup.arbitrum.io/rpc |
| Chain ID | 421614 |
| Currency Symbol | ETH |
| Block Explorer | https://sepolia.arbiscan.io |

---

## 2. Project Setup

```bash
# Clone the repository
git clone https://github.com/xvader/GovBond.git
cd GovBond

# Switch to the v2 branch
git checkout feat/govbond-v2

# Install dependencies
npm install
```

---

## 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required: deployer wallet private key (no 0x prefix)
PRIVATE_KEY=your_private_key_here

# Optional: for contract verification on Arbiscan
ARBISCAN_API_KEY=your_arbiscan_api_key_here
```

> **Security:** Never commit `.env`. It is in `.gitignore`. Use a dedicated testnet wallet — never your main wallet.

**How to export your private key from MetaMask:**
1. MetaMask → Account Details → Export Private Key
2. Remove the leading `0x` before pasting into `.env`

---

## 4. Compile & Test

```bash
# Compile all contracts
npm run compile

# Run the full test suite (66 tests)
npm test

# Generate coverage report
npm run coverage
```

Expected test output:
```
66 passing
```

Coverage report opens at `coverage/index.html`.

---

## 5. Deploy to Arbitrum Sepolia

### Step 1 — Deploy core contracts

```bash
npm run deploy
```

This deploys in order:
1. `IDRPToken` — Indonesian Rupiah stablecoin
2. `IdentityRegistry` — KYC whitelist
3. `ComplianceModule` — transfer rule engine
4. `GovBondToken (PMB25)` — the reference bond token
5. `GovBondVault` — async subscription/redemption vault

Then automatically:
- Grants `AGENT_ROLE` on bond to vault
- Grants `MINTER_ROLE` on IDRP to vault
- Registers deployer + vault in IdentityRegistry
- Mints 10,000,000,000 IDRP (Rp 100,000,000) to deployer for testing
- Saves addresses to `deployments/arbitrum-sepolia.json` and `frontend/deployments.json`

### Step 2 — Deploy BondFactory

```bash
npm run deploy:factory
```

This reads `deployments/arbitrum-sepolia.json` and deploys `BondFactory`, then:
- Grants `ISSUER_ROLE` to deployer
- Updates both deployment JSON files with the factory address

### Deployment output example

```
Deploying with: 0xYourAddress
IDRPToken: 0xAAA...
IdentityRegistry: 0xBBB...
ComplianceModule: 0xCCC...
GovBondToken: 0xDDD...
GovBondVault: 0xEEE...
Roles granted
Deployer and vault registered in IdentityRegistry
Minted 10,000,000,000 IDRP to deployer
Saved deployments
---
BondFactory: 0xFFF...
ISSUER_ROLE granted to deployer
Updated deployments with BondFactory address
```

---

## 6. Post-Deployment Setup

After deploying, complete these steps before going live:

### 6a. Register investor wallets

Every investor wallet must be registered in `IdentityRegistry` before they can hold or transfer bonds. Use the Admin Dashboard (Section 8) or call directly:

```js
// Via Hardhat console
const registry = await ethers.getContractAt("IdentityRegistry", "<REGISTRY_ADDRESS>");
await registry.registerInvestor("0xInvestorWallet", "ID");
```

### 6b. Grant MINTER_ROLE to new vaults (BondFactory deployments only)

When deploying a new bond via `BondFactory`, the factory **cannot** automatically grant `MINTER_ROLE` on IDRP. You must do this manually after each factory deployment:

```js
const idrp = await ethers.getContractAt("IDRPToken", "<IDRP_ADDRESS>");
await idrp.grantRole(ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")), "<NEW_VAULT_ADDRESS>");
```

The Issuer Portal shows the exact calldata after each deployment.

### 6c. Register new vault in IdentityRegistry

Same requirement — each new vault must be registered:

```js
await registry.registerInvestor("<NEW_VAULT_ADDRESS>", "ID");
```

### 6d. Fund vault with IDRP for coupon distribution

Before distributing coupons, the admin wallet needs IDRP. Use the faucet or mint:

```js
const idrp = await ethers.getContractAt("IDRPToken", "<IDRP_ADDRESS>");
await idrp.mint("<ADMIN_WALLET>", 10_000_000_000n); // Rp 100,000,000
```

---

## 7. Running the Frontend

The frontend is three standalone HTML files — no build step required.

```bash
cd frontend

# Option A: npx serve
npx serve .

# Option B: Python
python3 -m http.server 8080

# Option C: open directly in browser (file://)
open index.html
```

Then open in your browser:

| App | URL | Purpose |
|---|---|---|
| Investor Portal | http://localhost:3000/index.html | Subscribe, hold, redeem |
| Issuer Portal | http://localhost:3000/deploy-bond.html | Deploy new bond series |
| Admin Dashboard | http://localhost:3000/admin.html | Manage everything |

> **Note:** `frontend/deployments.json` is auto-generated by the deploy scripts. If it doesn't exist, copy it manually: `cp deployments/arbitrum-sepolia.json frontend/deployments.json`

---

## 8. Using the Admin Dashboard (`admin.html`)

Connect a wallet that has `DEFAULT_ADMIN_ROLE` or `AGENT_ROLE`.

### Overview
- Shows total bonds deployed, units outstanding, IDRP in circulation, registered investors
- Recent `InvestorRegistered` events from the last 50,000 blocks

### All Bonds
- Table of all bonds deployed via BondFactory
- Shows fill percentage, maturity status, links to Arbiscan

### Bond Holders
1. Select a bond from the dropdown
2. Table loads all holders with: KYC status, country, holdings, pending requests, coupons received, freeze status
3. **Bulk actions:** check multiple rows → Fulfill Deposits / Fulfill Redemptions
4. **Per-row actions:** Freeze/Unfreeze, Force Transfer

### KYC Registry
- **Register Investor:** single wallet + country code
- **Batch Register:** paste `address,country` pairs (one per line) or upload CSV; preview before submitting; auto-chunks at 100 per tx

### Compliance
- Set max holding cap (basis points)
- Block/unblock countries by ISO-2 code
- Transfer Check Tool: enter from/to/amount → see if transfer would pass

### Coupon Distribution
1. Select bond
2. See calculated monthly coupon amount (pre-filled)
3. Preview per-holder payout
4. Click **Approve IDRP** → then **Distribute Coupon**
5. Any rounding dust is returned to your wallet

### IDRP Token
- Mint IDRP to any address (requires `MINTER_ROLE`)
- Grant `MINTER_ROLE` to a new vault address
- Disable the testnet faucet

### Settings
- All contract addresses with Arbiscan links
- Network info

---

## 9. Using the Issuer Portal (`deploy-bond.html`)

Connect a wallet with `ISSUER_ROLE` on BondFactory.

1. Fill in the form:
   - **Bond Name** — e.g. "Palembang Municipal Bond 2026"
   - **Symbol** — max 8 chars, auto-uppercased
   - **Face Value** — Rp per unit (e.g. 1000000 = Rp 1,000,000)
   - **Coupon Rate** — % p.a. (e.g. 7.5)
   - **Maturity** — months from now (1–120)
   - **Max Supply** — total bond units (1–1,000,000)
2. Preview shows total programme value
3. Click **Deploy Bond**
4. After success, complete the **Post-Deploy Checklist**:
   - Grant `MINTER_ROLE` to the new vault (calldata shown)
   - Register investors in IdentityRegistry
   - Register the new vault in IdentityRegistry
   - Fund vault with IDRP for coupons

---

## 10. Using the Investor Portal (`index.html`)

Connect any wallet registered in `IdentityRegistry`.

**Subscribe (buy bonds):**
1. Enter amount in IDRP
2. Click **Approve** → **Request Deposit**
3. Wait for admin to fulfill (Admin Dashboard → Bond Holders → Fulfill Deposits)
4. Click **Claim Bonds** to receive PMB25 tokens

**Claim Coupons:**
- Coupons are pushed directly to your wallet during `distributeCoupon` — no claim needed

**Redeem (after maturity):**
1. Click **Approve Bonds** → **Request Redemption**
2. Wait for admin to fulfill
3. Click **Claim IDRP** to receive your principal back

---

## 11. Bond Lifecycle Walkthrough

Complete end-to-end flow:

```
1. Admin deploys contracts          npm run deploy && npm run deploy:factory
2. Admin registers investors        Admin Dashboard → KYC Registry
3. Investor approves IDRP           idrp.approve(vault, amount)
4. Investor requests deposit        vault.requestDeposit(amount, investor, investor)
5. Admin fulfills deposits          vault.fulfillDeposits([investor])
6. Investor claims bonds            vault.deposit(amount, investor, investor)
7. Admin distributes coupon         vault.distributeCoupon(totalPool)  [monthly]
8. [time passes — bond matures]
9. Investor approves bonds          bond.approve(vault, shares)
10. Investor requests redemption    vault.requestRedeem(shares, investor, investor)
11. Admin fulfills redemptions      vault.fulfillRedemptions([investor])
12. Investor claims IDRP            vault.redeem(shares, investor, investor)
```

**IDRP decimal math:**

| Human amount | IDRP base units |
|---|---|
| Rp 1.00 | `100` |
| Rp 1,000,000 (1 bond) | `100_000_000` |
| Rp 100,000,000 | `10_000_000_000` |

---

## 12. Local Development

```bash
# Terminal 1 — start local Hardhat node
npm run node

# Terminal 2 — deploy to local node
npm run deploy:local

# Run tests
npm test

# Coverage
npm run coverage
# Open coverage/index.html in browser
```

The local node runs at `http://127.0.0.1:8545` with 20 pre-funded accounts.

**Hardhat console (interactive):**
```bash
npx hardhat console --network localhost
```

```js
const idrp = await ethers.getContractAt("IDRPToken", "<address>");
await idrp.balanceOf("<wallet>");
```

---

## 13. Contract Verification

After deploying to Arbitrum Sepolia, verify contracts on Arbiscan:

```bash
# Verify IDRPToken (no constructor args)
npx hardhat verify --network arbitrumSepolia <IDRP_ADDRESS>

# Verify IdentityRegistry
npx hardhat verify --network arbitrumSepolia <REGISTRY_ADDRESS>

# Verify ComplianceModule
npx hardhat verify --network arbitrumSepolia <COMPLIANCE_ADDRESS> "<REGISTRY_ADDRESS>"

# Verify GovBondToken
npx hardhat verify --network arbitrumSepolia <BOND_ADDRESS> \
  "Palembang Municipal Bond 2025" "PMB25" \
  "<REGISTRY_ADDRESS>" "<COMPLIANCE_ADDRESS>" \
  <MATURITY_TIMESTAMP> 750 100000 100000000

# Verify GovBondVault
npx hardhat verify --network arbitrumSepolia <VAULT_ADDRESS> \
  "<BOND_ADDRESS>" "<IDRP_ADDRESS>" 100000000

# Verify BondFactory
npx hardhat verify --network arbitrumSepolia <FACTORY_ADDRESS> \
  "<IDRP_ADDRESS>" "<REGISTRY_ADDRESS>" "<COMPLIANCE_ADDRESS>"
```

> Get `MATURITY_TIMESTAMP` from `deployments/arbitrum-sepolia.json` → `maturityDate` field.

---

## 14. Merging & Tagging a Release

When ready to make v2 the main branch:

```bash
git checkout main
git merge feat/govbond-v2
git push origin main

# Tag the release
git tag v2.0.0
git push origin v2.0.0
```

Or use the helper script:
```bash
bash scripts/push-to-github.sh https://github.com/xvader/GovBond.git
```

---

## 15. Troubleshooting

### "Compliance check failed" on transfer
The recipient wallet is not registered in `IdentityRegistry`. Register it first via Admin Dashboard → KYC Registry.

### "Bond not yet matured" on requestRedeem
The bond's `maturityDate` hasn't passed. Check: `await bond.redeemable()` — returns `false` until maturity.

### "Pending deposit exists" on requestDeposit
The investor already has an unfulfilled deposit request. Admin must call `fulfillDeposits([investor])` first, or `resetDepositRequest(investor)` to cancel it.

### "Cap reached" on mint / "Bond cap reached" on deposit
The bond's `maxSupply` has been reached. No more subscriptions possible.

### Vault can't burn IDRP on redeem
The vault doesn't have `MINTER_ROLE` on IDRPToken. Run:
```js
await idrp.grantRole(MINTER_ROLE, vaultAddress);
```

### Frontend shows blank / no contracts
`frontend/deployments.json` is missing or empty. Copy it:
```bash
cp deployments/arbitrum-sepolia.json frontend/deployments.json
```

### MetaMask "wrong network"
Switch MetaMask to **Arbitrum Sepolia** (Chain ID 421614).

### Tests fail with "Compliance check failed" in requestRedeem
The vault address is not registered in `IdentityRegistry`. The deploy script handles this automatically — if testing manually, register the vault:
```js
await registry.registerInvestor(vaultAddress, "ID");
```
