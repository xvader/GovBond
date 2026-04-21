# GovBond — Municipal Bond Tokenization Protocol

> Privacy-preserving municipal bond issuance and settlement on Arbitrum Sepolia.
> Built for Indonesian regional governments (Pemerintah Daerah).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue.svg)](https://soliditylang.org)
[![Network](https://img.shields.io/badge/Network-Arbitrum%20Sepolia-orange.svg)](https://sepolia.arbiscan.io)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-yellow.svg)](https://hardhat.org)

## Overview

GovBond tokenizes Indonesian regional government bonds (*obligasi daerah*) on Arbitrum Sepolia, enabling compliant on-chain subscription, coupon distribution, and redemption. The protocol implements ERC-3643 (T-REX) for KYC-gated security tokens and ERC-7540 for asynchronous vault mechanics, giving treasury teams full control over investor eligibility and bond lifecycle.

The system is designed for the Palembang Municipal Bond 2025 (PMB25) as a reference deployment, but the `BondFactory` contract allows any authorized issuer to deploy new bond series without redeploying the core infrastructure.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                       Investor                           │
│  requestDeposit() ──► GovBondVault ──► fulfillDeposits() │
│  deposit()        ◄──             ◄── (admin)            │
│  requestRedeem()  ──►             ──► fulfillRedemptions │
│  redeem()         ◄──             ◄── (admin)            │
└──────────────────────────────────────────────────────────┘
         │ mint/burn                    │ canTransfer
         ▼                              ▼
  GovBondToken (PMB25)          ComplianceModule
  ERC-3643 security token            │
         │ isVerified                  │ isVerified
         ▼                            ▼
  IdentityRegistry (KYC)       IdentityRegistry (KYC)

  IDRPToken — settlement token (2 decimals, MINTER_ROLE gated)

  BondFactory — deploys GovBondToken + GovBondVault pairs
```

## Contracts

| Contract | Description | Audited |
|---|---|---|
| `IDRPToken.sol` | Indonesian Rupiah stablecoin, 2 decimals, MINTER_ROLE gated, testnet faucet | ✓ |
| `IdentityRegistry.sol` | On-chain KYC whitelist with country codes | ✓ |
| `ComplianceModule.sol` | Transfer rule engine: KYC, freeze, country blocklist, max holding cap | ✓ |
| `GovBondToken.sol` | ERC-3643 bond token, 0 decimals, maturity enforcement, forced transfer | ✓ |
| `GovBondVault.sol` | ERC-7540 async vault: subscription, coupon distribution, redemption | ✓ |
| `BondFactory.sol` | Multi-bond deployer, ISSUER_ROLE gated | ✓ |

## Token Standards

- **ERC-3643 (T-REX)** — Permissioned security token. Every transfer checks `ComplianceModule.canTransfer()`. Agents can freeze wallets and execute forced transfers for regulatory compliance.
- **ERC-7540** — Asynchronous tokenized vault. Investors request deposits/redemptions; admins fulfill them in batches. Prevents front-running and enables off-chain KYC verification before minting.
- **Privacy model** — All investor data (KYC status, country, holdings) is on-chain but pseudonymous. The `IdentityRegistry` maps wallet addresses to ISO-2 country codes; no PII is stored on-chain.

## Bond Parameters

| Parameter | Value |
|---|---|
| Name | Palembang Municipal Bond 2025 |
| Symbol | PMB25 |
| Decimals | 0 (whole units only) |
| Face Value | Rp 1,000,000 per unit (`100_000_000` IDRP base units) |
| Coupon Rate | 750 bps (7.5% p.a.) |
| Maturity | 1 year from deployment |
| Max Supply | 100,000 units |
| Settlement | IDRP (2 decimals) |

## Quick Start

### Prerequisites

- Node.js 18+
- MetaMask with Arbitrum Sepolia network
- Arbitrum Sepolia ETH — [faucet](https://faucet.triangleplatform.com/arbitrum/sepolia)

### Installation

```bash
git clone https://github.com/xvader/GovBond.git
cd GovBond
npm install
cp .env.example .env
# Edit .env: add PRIVATE_KEY and optionally ARBISCAN_API_KEY
```

### Compile & Test

```bash
npm run compile
npm test
npm run coverage
```

### Deploy

```bash
# Deploy core contracts (IDRPToken, IdentityRegistry, ComplianceModule, GovBondToken, GovBondVault)
npm run deploy

# Deploy BondFactory (reads addresses from deployments/arbitrum-sepolia.json)
npm run deploy:factory
```

Both scripts write addresses to `deployments/arbitrum-sepolia.json` and `frontend/deployments.json`.

### Frontend Setup

After deployment, open any of the frontend apps directly in a browser (no build step):

```bash
cd frontend
npx serve .   # or: python3 -m http.server 8080
```

## Frontend Apps

| App | File | Purpose |
|---|---|---|
| Investor Portal | `frontend/index.html` | Subscribe, view holdings, claim coupons, redeem |
| Issuer Portal | `frontend/deploy-bond.html` | Deploy new bond series via BondFactory |
| Admin Dashboard | `frontend/admin.html` | KYC management, fulfillment, coupon distribution, compliance |

## User Flows

**Subscription:**
1. Investor calls `idrp.approve(vault, amount)`
2. Investor calls `vault.requestDeposit(amount, controller, owner)`
3. Admin calls `vault.fulfillDeposits([investor])`
4. Investor calls `vault.deposit(amount, receiver, controller)` → receives PMB25

**Coupon Distribution:**
1. Admin calls `idrp.approve(vault, totalPool)`
2. Admin calls `vault.distributeCoupon(totalPool)` → pro-rata payout to all holders

**Redemption (post-maturity):**
1. Investor calls `bond.approve(vault, shares)`
2. Investor calls `vault.requestRedeem(shares, controller, owner)`
3. Admin calls `vault.fulfillRedemptions([investor])`
4. Investor calls `vault.redeem(shares, receiver, controller)` → receives IDRP, PMB25 burned

## Security

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the full audit report.

Key protections:
- `ReentrancyGuard` on all vault state-changing functions
- KYC-gated transfers — no token movement without both parties in `IdentityRegistry`
- Maturity enforcement — redemption requests revert before `maturityDate`
- No public mint — `IDRPToken` requires `MINTER_ROLE`; faucet has 24hr cooldown
- Custom errors for gas-efficient reverts in `GovBondVault`
- `forcedTransfer` uses a flag to bypass compliance for regulatory actions; flag is resettable by admin

## IDRP Token

`IDRPToken` uses **2 decimals** (sen subunit). Key conversions:

| Value | IDRP base units |
|---|---|
| Rp 1.00 | `100` |
| Rp 1,000,000.00 (1 bond unit) | `100_000_000` |
| Rp 100,000,000.00 (test mint) | `10_000_000_000` |

The vault requires `MINTER_ROLE` on `IDRPToken` to process redemptions. After deploying a new bond via `BondFactory`, the IDRP admin must manually call `idrp.grantRole(MINTER_ROLE, vaultAddress)`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PRIVATE_KEY` | Yes | Deployer wallet private key (no `0x` prefix) |
| `ARBISCAN_API_KEY` | No | For contract verification on Arbiscan |

## Contract Addresses

See `deployments/arbitrum-sepolia.json` after running the deploy scripts. The file is excluded from git (`.gitignore`) — add addresses to this table after deployment:

| Contract | Address |
|---|---|
| IDRPToken | — |
| IdentityRegistry | — |
| ComplianceModule | — |
| GovBondToken (PMB25) | — |
| GovBondVault | — |
| BondFactory | — |

## Development

```bash
npm run node          # Start local Hardhat node
npm run deploy:local  # Deploy to local node
npm test              # Run test suite
npm run coverage      # Coverage report
```

## License

MIT — see [LICENSE](LICENSE)
