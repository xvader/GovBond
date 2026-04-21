# GovBond Security Audit

**Scope:** contracts/IDRPToken.sol, GovBondToken.sol, GovBondVault.sol, ComplianceModule.sol, IdentityRegistry.sol, BondFactory.sol  
**Auditor:** Internal review (GovBond v2)  
**Status:** All HIGH and MEDIUM findings fixed.

---

## Findings

### HIGH-01 — Reentrancy in GovBondVault
**Status: Fixed**  
`distributeCoupon`, `redeem`, and `deposit` made external calls (safeTransfer, mint, burn) without reentrancy protection. A malicious ERC-20 token or bond token could re-enter the vault.

**Fix:** Imported `ReentrancyGuard` and applied `nonReentrant` to `requestDeposit`, `deposit`, `requestRedeem`, `redeem`, `distributeCoupon`, `sweepToken`. All state updates (`.claimed = true`, `hasPendingDeposit = false`) are performed before external calls (checks-effects-interactions).

---

### HIGH-02 — Integer overflow in ComplianceModule maxHolding check
**Status: Fixed**  
`newBalance * 10000 > maxHoldingBps * totalSupply` could overflow if `newBalance` approached `type(uint256).max / 10000`.

**Fix:** Restructured to `newBalance > (maxHoldingBps * totalSupply) / 10000`. Safe under the documented assumption that `totalSupply < type(uint256).max / 10000` (realistic for any bond issuance).

---

### HIGH-03 — No rate limiting on IDRPToken.faucet()
**Status: Fixed**  
When `testnetFaucetEnabled = true`, any address could call `faucet()` unlimited times, minting unbounded IDRP.

**Fix:** Added `mapping(address => uint256) public lastFaucetTime` with a 24-hour per-address cooldown enforced in `faucet()`.

---

### MEDIUM-01 — Coupon rounding dust accumulates in vault
**Status: Fixed**  
Integer division in `(totalCouponPool * bal) / totalSupply` leaves remainder dust permanently locked in the vault.

**Fix:** Track `totalPaid` in the distribution loop. After the loop, any `dust = totalCouponPool - totalPaid` is returned to the caller (`msg.sender`) and emits `DustReturned(uint256 amount)`.

---

### MEDIUM-02 — No input validation in BondFactory.deployBond
**Status: Fixed**  
No bounds checking allowed deployment of bonds with empty names, zero face value, 100% coupon rates, or zero supply.

**Fix:** Added requires:
- `bytes(name).length > 0 && <= 64`
- `bytes(symbol).length >= 2 && <= 8`
- `faceValueIDRP >= 100` (min Rp 1.00)
- `couponRateBps <= 5000` (max 50%)
- `maturityMonths >= 1 && <= 120`
- `maxSupplyUnits >= 1 && <= 1_000_000`

---

### MEDIUM-03 — forcedTransfer bypasses frozen check
**Status: Fixed**  
`forcedTransfer` called `_transfer` which invoked `_update`, triggering the frozen check and reverting — defeating the regulatory purpose of forced transfers.

**Fix:** Added `bool private _forcedTransferActive` flag. When set, `_update` calls `ERC20._update` directly, bypassing all compliance hooks. Added `resetForcedFlag()` (admin-only) as emergency recovery if a revert leaves the flag set. Only `AGENT_ROLE` can trigger this path.

---

### LOW-01 — Missing events
**Status: Fixed**
- `ComplianceModule.blockCountry` now emits `CountryBlocked(bytes2 country, bool blocked)`
- `GovBondVault.setBondPrice` emits `BondPriceUpdated(oldPrice, newPrice)`
- `IdentityRegistry.batchRegister` emits `InvestorRegistered` per entry (already present)
- `BondFactory.deployBond` emits `BondDeployed`

---

### LOW-02 — Batch registration DoS via gas limit
**Status: Fixed**  
`batchRegister` with a very large array could exceed the block gas limit.

**Fix:** Added `require(investors.length <= 200, "Batch too large")` in `IdentityRegistry.batchRegister`.

---

### LOW-03 — IDRP decimal mismatch documentation
**Status: Fixed**  
The 2-decimal IDRP / 0-decimal bond unit math was undocumented, creating audit risk.

**Fix:** Added NatSpec comment block at the top of `GovBondVault` explaining the decimal model with worked examples.

---

### INFO-01 — Custom errors for gas efficiency
**Status: Fixed**  
`GovBondVault` used string-based `require` statements, costing extra gas on revert.

**Fix:** Replaced all `require(condition, "string")` in `GovBondVault` with custom errors (`ZeroAssets`, `PendingDepositExists`, `NoRequest`, `NotClaimable`, `AmountMismatch`, `NotWholeNumberOfBonds`, `BondCapReached`, `ZeroCoupon`, `NoSupply`, `UseEmergencyFlag`, `BondNotMatured`, `ZeroShares`, `PendingRedeemExists`). String-based requires retained in `GovBondToken` for ERC-3643 readability.

---

### INFO-02 — NatSpec coverage
**Status: Fixed**  
All public/external functions in `GovBondVault` now have `@notice` and `@dev` NatSpec comments.

---

## Residual Risks

| Risk | Severity | Notes |
|---|---|---|
| `_forcedTransferActive` flag stuck on revert | Low | Mitigated by `resetForcedFlag()`. Only AGENT_ROLE can trigger. |
| `distributeCoupon` iterates unbounded set | Low | Bounded by `maxSupplyUnits <= 1,000,000` in factory. For large holder sets, consider off-chain batching. |
| Factory cannot auto-grant MINTER_ROLE on IDRP | Info | By design — IDRP admin must manually call `grantRole(MINTER_ROLE, vault)` after each bond deploy. Issuer Portal shows a checklist. |
| Compliance country check uses `bytes2(bytes(string))` | Info | Only the first 2 bytes of the country string are used. Enforced as ISO-2 by convention; no on-chain validation of valid ISO codes. |

---

## Recommended Post-Deployment Monitoring

1. **Alert on `DustReturned`** — large dust amounts indicate supply imbalance or rounding issues worth investigating.
2. **Alert on `TokensFrozen`** — monitor for unexpected freeze events on large holders.
3. **Alert on `ForcedTransfer`** — all forced transfers should be logged and reviewed by compliance.
4. **Monitor `_forcedTransferActive`** — if `resetForcedFlag()` is ever called, investigate the triggering transaction.
5. **Watch `BondDeployed` events** — verify each new bond has `MINTER_ROLE` granted to its vault before subscriptions open.
6. **Faucet abuse** — monitor `lastFaucetTime` mapping on testnet; disable faucet before any mainnet migration.
