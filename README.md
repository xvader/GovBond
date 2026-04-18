# GovBond — Confidential Municipal Bond Tokenization

A fully on-chain municipal bond tokenization protocol built on **Arbitrum Sepolia**, targeting the **Confidential DeFi & RWA** hackathon track. GovBond tokenizes the *Palembang Municipal Bond 2025* (PMB25), enabling compliant subscription, coupon distribution, and redemption through a set of interoperable smart contracts.

---

## Standards Implemented

| Standard | Role |
|---|---|
| **ERC-3643 (T-REX)** | Permissioned security token with KYC, freeze, forced transfer |
| **ERC-7540** | Asynchronous tokenized vault — subscription and redemption requests |
| **ERC-20 / ERC-20Burnable** | Base token mechanics |
| **OpenZeppelin AccessControl** | Role-based admin, agent, and compliance roles |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Investor                           │
│  requestDeposit() ──► GovBondVault ──► fulfillDeposits()│
│  deposit()        ◄──             ◄── (admin)           │
│  requestRedeem()  ──►             ──► fulfillRedemptions│
│  redeem()         ◄──             ◄── (admin)           │
└─────────────────────────────────────────────────────────┘
         │ mint/burn                    │ canTransfer
         ▼                              ▼
  GovBondToken (PMB25)          ComplianceModule
  ERC-3643 security token            │
         │ isVerified                  │ isVerified
         ▼                            ▼
  IdentityRegistry (KYC)       IdentityRegistry (KYC)

  MockUSDC — settlement token (testnet faucet)
```

---

## Contracts

### `GovBondToken.sol` — ERC-3643 Bond Token

The core security token representing one unit of the Palembang Municipal Bond 2025.

| Property | Value |
|---|---|
| Name | Palembang Municipal Bond 2025 |
| Symbol | PMB25 |
| Decimals | 18 |
| Face Value | Rp 1,000,000 per unit |
| Coupon Rate | 750 bps (7.5% p.a.) |
| Maturity | Set at deployment (1 year) |

**Key mechanics:**
- Every `transfer` / `transferFrom` checks `ComplianceModule.canTransfer()` — both parties must be KYC-verified and unfrozen
- `mint(address, uint256)` — only `AGENT_ROLE`, recipient must be verified
- `freeze(address, bool)` — agent can freeze/unfreeze wallets; emits `TokensFrozen`
- `forcedTransfer(from, to, amount)` — agent override, bypasses compliance
- `pause()` / `unpause()` — admin halts all transfers
- Extends `ERC20Burnable` — vault burns shares on redemption

**Roles:**

| Role | Capabilities |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Pause, set registry/compliance, grant roles |
| `AGENT_ROLE` | Mint, freeze, forced transfer |
| `COMPLIANCE_ROLE` | Update compliance rules (max holding) |

---

### `IdentityRegistry.sol` — KYC Whitelist

Maintains the on-chain investor whitelist.

```solidity
mapping(address => bool)    public isVerified;
mapping(address => string)  public investorCountry;  // ISO-2
mapping(address => uint256) public verifiedAt;
```

- `registerInvestor(address, string)` — agent registers a single investor
- `removeInvestor(address)` — agent removes an investor
- `batchRegister(address[], string[])` — bulk registration

---

### `ComplianceModule.sol` — Transfer Rule Engine

Called by `GovBondToken` before every transfer. Returns `false` (blocking the transfer) if any rule fails:

1. Both `from` and `to` must be verified in `IdentityRegistry` (minting from `address(0)` only checks recipient)
2. Neither party can be frozen
3. Optional: `maxHoldingBps` — cap per investor as a % of total supply (e.g. `1000` = 10%)

---

### `GovBondVault.sol` — ERC-7540 Async Subscription Vault

Handles the full bond lifecycle: subscription, fulfillment, coupon distribution, and redemption.

**Deposit flow (subscription):**
```
1. Investor: approve USDC → vault
2. Investor: requestDeposit(assets, controller, owner)  → emits DepositRequest_
3. Admin:    fulfillDeposits([investor])                → emits DepositClaimable
4. Investor: deposit(assets, receiver, controller)      → mints PMB25 to receiver
```

**Redemption flow:**
```
1. Investor: approve PMB25 → vault
2. Investor: requestRedeem(shares, controller, owner)   → emits RedeemRequest_
             ⚠ Reverts if block.timestamp < maturityDate
3. Admin:    fulfillRedemptions([investor])             → emits RedeemClaimable
4. Investor: redeem(shares, receiver, controller)       → transfers USDC, burns PMB25
```

**Coupon distribution:**
```
Admin: approve USDC → vault
Admin: distributeCoupon(totalCouponPool)
       → iterates on-chain EnumerableSet of bondholders
       → pays pro-rata: coupon = (pool × holderBalance) / totalSupply
       → emits CouponPaid(holder, amount) per payout
```

**Bond price:** `bondPrice` (in USDC 6-decimal units). Default `1e6` = 1 USDC per bond unit.
Conversion: `shares = (usdcAmount × 1e18) / bondPrice`

**Admin utilities:**

| Function | Description |
|---|---|
| `fulfillDeposits(address[])` | Approve pending subscriptions |
| `fulfillRedemptions(address[])` | Approve pending redemptions |
| `setBondPrice(uint256)` | Update bond price; emits `BondPriceUpdated` |
| `withdrawDust(token, amount)` | Recover stuck tokens (non-USDC by default) |
| `setEmergencyWithdrawUSDC(bool)` | Two-step gate to allow USDC recovery |
| `resetDepositRequest(address)` | Unblock a stuck deposit request |
| `resetRedeemRequest(address)` | Unblock a stuck redemption request |
| `getHolders()` | Returns current bondholder set |

---

### `MockUSDC.sol` — Testnet Settlement Token

Standard ERC-20 with 6 decimals and a public `mint()` faucet for testnet use.

---

## Project Structure

```
govbond/
├── contracts/
│   ├── GovBondToken.sol       # ERC-3643 bond token
│   ├── IdentityRegistry.sol   # KYC whitelist
│   ├── ComplianceModule.sol   # Transfer rule engine
│   ├── GovBondVault.sol       # ERC-7540 async vault
│   └── MockUSDC.sol           # Testnet USDC faucet
├── scripts/
│   └── deploy.js              # Deployment script
├── test/
│   └── GovBond.test.js        # Hardhat + Chai test suite
├── frontend/
│   ├── index.html             # Single-file dApp
│   └── deployments.json       # Auto-generated after deploy
├── deployments/
│   └── arbitrum-sepolia.json  # Generated after deploy
├── hardhat.config.js
├── package.json
└── .env.example
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MetaMask with Arbitrum Sepolia network
- Arbitrum Sepolia ETH (faucet: https://faucet.triangleplatform.com/arbitrum/sepolia)

### Install

```bash
git clone https://github.com/xvader/GovBond.git
cd GovBond
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
PRIVATE_KEY=your_deployer_private_key
ARBISCAN_API_KEY=your_arbiscan_api_key   # optional, for verification
```

### Compile

```bash
npx hardhat compile
```

### Test

```bash
npx hardhat test
```

All 12 tests cover:
- Identity registry: register, verify, remove, batch
- Bond minting: verified succeeds, unverified reverts
- Transfers: verified→verified passes, verified→unverified reverts
- Vault deposit: request emits event, admin fulfills, investor claims
- Coupon distribution: correct pro-rata amounts
- Freeze: frozen address cannot transfer
- Pause: all transfers revert

### Deploy to Arbitrum Sepolia

```bash
npx hardhat run scripts/deploy.js --network arbitrumSepolia
```

This will:
1. Deploy all 5 contracts in dependency order
2. Wire roles and registry references
3. Register the deployer as a verified investor
4. Mint 1,000,000 USDC to the deployer for testing
5. Write addresses to `deployments/arbitrum-sepolia.json` **and** `frontend/deployments.json`

---

## Frontend

Open `frontend/index.html` in a browser (or serve it locally):

```bash
cd frontend
npx serve .   # or python3 -m http.server 8080
```

The frontend auto-loads contract addresses from `./deployments.json` on startup. If addresses are not configured, a red banner is shown and all buttons are disabled.

**Three panels:**

**Bond Info** — name, symbol, coupon rate, maturity date, total supply, contract link on Arbiscan.

**Investor Dashboard** — wallet address, KYC status badge, USDC balance, PMB25 holdings (with masked/reveal toggle), pending deposit, claimable bonds, total coupons received.

**Actions:**
- *Subscribe* — enter USDC amount → `requestDeposit()`
- *Redeem* — enter bond units → `requestRedeem()` (only works post-maturity)
- *Admin* (deployer only) — register investors, fulfill deposits, distribute coupons, mint test USDC

Every transaction shows a link to Arbiscan after confirmation.

---

## Security Notes

- **KYC-gated transfers** — no token movement is possible without both parties being registered in `IdentityRegistry`
- **Maturity enforcement** — redemption requests revert before `maturityDate`
- **USDC drain protection** — `withdrawDust` blocks USDC unless `emergencyWithdrawUSDC` is explicitly enabled by admin
- **Pause circuit breaker** — admin can halt all transfers instantly
- **Forced transfer** — agent can move tokens for regulatory compliance (e.g. court order)
- **Private keys** — never commit `.env`; use hardware wallets for mainnet deployment

---

## Network

| Parameter | Value |
|---|---|
| Network | Arbitrum Sepolia |
| Chain ID | 421614 |
| RPC | https://sepolia-rollup.arbitrum.io/rpc |
| Explorer | https://sepolia.arbiscan.io |

---

## License

MIT
