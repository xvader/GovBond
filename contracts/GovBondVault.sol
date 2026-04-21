// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGovBondToken {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function couponRate() external view returns (uint256);
    function maturityDate() external view returns (uint256);
    function redeemable() external view returns (bool);
}

/// @notice ERC-7540 async vault for GovBond municipal bond subscriptions and redemptions.
/// @dev IDRP: 2 decimals. 1 bond unit = bondPrice IDRP base units.
///      Example: bondPrice=100_000_000 → Rp 1,000,000.00 per bond unit.
///      deposit(100_000_000) → 1 bond unit minted (0-decimal).
///      redeem(1) → 100_000_000 IDRP base units returned.
contract GovBondVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    IGovBondToken public immutable bondToken;
    IERC20 public immutable idrp;

    struct DepositRequest {
        address investor;
        uint256 assets;
        uint256 timestamp;
        bool claimable;
        bool claimed;
    }

    struct RedeemRequest {
        address investor;
        uint256 shares;
        uint256 timestamp;
        bool claimable;
        bool claimed;
    }

    uint256 public nextDepositRequestId;
    uint256 public nextRedeemRequestId;

    mapping(uint256 => DepositRequest) public depositRequests;
    mapping(address => uint256) public investorDepositRequestId;
    mapping(address => bool) public hasPendingDeposit;

    mapping(uint256 => RedeemRequest) public redeemRequests;
    mapping(address => uint256) public investorRedeemRequestId;
    mapping(address => bool) public hasPendingRedeem;

    mapping(address => uint256) public couponsReceived;

    uint256 public bondPrice;
    bool public emergencyWithdrawIDRP;

    EnumerableSet.AddressSet private _bondholders;

    // ── Custom errors ─────────────────────────────────────────────────────────
    error ZeroAssets();
    error PendingDepositExists();
    error ZeroShares();
    error PendingRedeemExists();
    error BondNotMatured();
    error NoRequest();
    error NotClaimable();
    error AmountMismatch();
    error NotWholeNumberOfBonds();
    error BondCapReached();
    error ZeroCoupon();
    error NoSupply();
    error UseEmergencyFlag();

    // ── Events ────────────────────────────────────────────────────────────────
    event DepositRequest_(uint256 indexed requestId, address indexed controller, address indexed owner, uint256 assets);
    event RedeemRequest_(uint256 indexed requestId, address indexed controller, address indexed owner, uint256 shares);
    event DepositClaimable(uint256 indexed requestId, address indexed controller, uint256 assets);
    event RedeemClaimable(uint256 indexed requestId, address indexed controller, uint256 shares);
    event CouponPaid(address indexed holder, uint256 amount);
    event CouponDistributed(uint256 totalAmount, uint256 holderCount, uint256 timestamp);
    event DustReturned(uint256 amount);
    event BondPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event TokenSwept(address indexed token, address indexed to, uint256 amount);

    constructor(address _bondToken, address _idrp, uint256 _bondPrice) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(AGENT_ROLE, msg.sender);
        bondToken = IGovBondToken(_bondToken);
        idrp = IERC20(_idrp);
        bondPrice = _bondPrice;
    }

    function _trackHolder(address addr) internal {
        if (bondToken.balanceOf(addr) > 0) _bondholders.add(addr);
        else _bondholders.remove(addr);
    }

    // ── ERC-7540 Deposit ──────────────────────────────────────────────────────

    /// @notice Investor submits a deposit request. IDRP is locked in vault.
    function requestDeposit(uint256 assets, address controller, address owner)
        external nonReentrant returns (uint256 requestId)
    {
        if (assets == 0) revert ZeroAssets();
        if (hasPendingDeposit[controller]) revert PendingDepositExists();
        idrp.safeTransferFrom(owner, address(this), assets);
        requestId = nextDepositRequestId++;
        depositRequests[requestId] = DepositRequest(controller, assets, block.timestamp, false, false);
        investorDepositRequestId[controller] = requestId;
        hasPendingDeposit[controller] = true;
        emit DepositRequest_(requestId, controller, owner, assets);
    }

    /// @notice Returns pending (not yet claimable) deposit amount for a request.
    function pendingDepositRequest(uint256 requestId, address controller) external view returns (uint256) {
        DepositRequest storage r = depositRequests[requestId];
        if (r.investor != controller || r.claimable || r.claimed) return 0;
        return r.assets;
    }

    /// @notice Returns claimable deposit amount for a request.
    function claimableDepositRequest(uint256 requestId, address controller) external view returns (uint256) {
        DepositRequest storage r = depositRequests[requestId];
        if (r.investor != controller || !r.claimable || r.claimed) return 0;
        return r.assets;
    }

    /// @notice Investor claims bond tokens after admin fulfills deposit.
    /// @param assets Must equal the original request amount and be a whole multiple of bondPrice.
    function deposit(uint256 assets, address receiver, address controller)
        external nonReentrant returns (uint256 shares)
    {
        uint256 requestId = investorDepositRequestId[controller];
        DepositRequest storage r = depositRequests[requestId];
        if (r.investor != controller) revert NoRequest();
        if (!r.claimable || r.claimed) revert NotClaimable();
        if (r.assets != assets) revert AmountMismatch();
        if (assets % bondPrice != 0) revert NotWholeNumberOfBonds();
        shares = assets / bondPrice;
        if (bondToken.totalSupply() + shares > bondToken.maxSupply()) revert BondCapReached();
        // effects before interactions
        r.claimed = true;
        hasPendingDeposit[controller] = false;
        bondToken.mint(receiver, shares);
        _trackHolder(receiver);
    }

    // ── ERC-7540 Redeem ───────────────────────────────────────────────────────

    /// @notice Investor submits a redemption request. Bond tokens are locked in vault.
    /// @dev Reverts if bond has not reached maturityDate.
    function requestRedeem(uint256 shares, address controller, address owner)
        external nonReentrant returns (uint256 requestId)
    {
        if (!bondToken.redeemable()) revert BondNotMatured();
        if (shares == 0) revert ZeroShares();
        if (hasPendingRedeem[controller]) revert PendingRedeemExists();
        bondToken.transferFrom(owner, address(this), shares);
        requestId = nextRedeemRequestId++;
        redeemRequests[requestId] = RedeemRequest(controller, shares, block.timestamp, false, false);
        investorRedeemRequestId[controller] = requestId;
        hasPendingRedeem[controller] = true;
        emit RedeemRequest_(requestId, controller, owner, shares);
    }

    /// @notice Returns pending (not yet claimable) redeem shares for a request.
    function pendingRedeemRequest(uint256 requestId, address controller) external view returns (uint256) {
        RedeemRequest storage r = redeemRequests[requestId];
        if (r.investor != controller || r.claimable || r.claimed) return 0;
        return r.shares;
    }

    /// @notice Returns claimable redeem shares for a request.
    function claimableRedeemRequest(uint256 requestId, address controller) external view returns (uint256) {
        RedeemRequest storage r = redeemRequests[requestId];
        if (r.investor != controller || !r.claimable || r.claimed) return 0;
        return r.shares;
    }

    /// @notice Investor claims IDRP after admin fulfills redemption. Bond tokens are burned.
    function redeem(uint256 shares, address receiver, address controller)
        external nonReentrant returns (uint256 assets)
    {
        uint256 requestId = investorRedeemRequestId[controller];
        RedeemRequest storage r = redeemRequests[requestId];
        if (r.investor != controller) revert NoRequest();
        if (!r.claimable || r.claimed) revert NotClaimable();
        if (r.shares != shares) revert AmountMismatch();
        // checks-effects-interactions: update state before external calls
        r.claimed = true;
        hasPendingRedeem[controller] = false;
        assets = shares * bondPrice;
        bondToken.burn(shares);
        idrp.safeTransfer(receiver, assets);
        _trackHolder(controller);
    }

    // ── Admin fulfillment ─────────────────────────────────────────────────────

    /// @notice Admin approves pending deposit requests, making them claimable.
    function fulfillDeposits(address[] calldata investors) external onlyRole(AGENT_ROLE) {
        for (uint256 i = 0; i < investors.length; i++) {
            address inv = investors[i];
            if (!hasPendingDeposit[inv]) continue;
            uint256 requestId = investorDepositRequestId[inv];
            DepositRequest storage r = depositRequests[requestId];
            if (!r.claimable && !r.claimed) {
                r.claimable = true;
                emit DepositClaimable(requestId, inv, r.assets);
            }
        }
    }

    /// @notice Admin approves pending redemption requests, making them claimable.
    function fulfillRedemptions(address[] calldata investors) external onlyRole(AGENT_ROLE) {
        for (uint256 i = 0; i < investors.length; i++) {
            address inv = investors[i];
            if (!hasPendingRedeem[inv]) continue;
            uint256 requestId = investorRedeemRequestId[inv];
            RedeemRequest storage r = redeemRequests[requestId];
            if (!r.claimable && !r.claimed) {
                r.claimable = true;
                emit RedeemClaimable(requestId, inv, r.shares);
            }
        }
    }

    // ── Coupon distribution ───────────────────────────────────────────────────

    /// @notice Distributes IDRP pro-rata to all bondholders. Dust is returned to caller.
    /// @param totalCouponPool Total IDRP (2 decimals) to distribute.
    function distributeCoupon(uint256 totalCouponPool) external nonReentrant onlyRole(AGENT_ROLE) {
        if (totalCouponPool == 0) revert ZeroCoupon();
        idrp.safeTransferFrom(msg.sender, address(this), totalCouponPool);
        uint256 totalSupply = bondToken.totalSupply();
        if (totalSupply == 0) revert NoSupply();
        uint256 len = _bondholders.length();
        uint256 totalPaid;
        for (uint256 i = 0; i < len; i++) {
            address holder = _bondholders.at(i);
            uint256 bal = bondToken.balanceOf(holder);
            if (bal == 0) continue;
            uint256 coupon = (totalCouponPool * bal) / totalSupply;
            if (coupon > 0) {
                couponsReceived[holder] += coupon;
                totalPaid += coupon;
                idrp.safeTransfer(holder, coupon);
                emit CouponPaid(holder, coupon);
            }
        }
        uint256 dust = totalCouponPool - totalPaid;
        if (dust > 0) {
            idrp.safeTransfer(msg.sender, dust);
            emit DustReturned(dust);
        }
        emit CouponDistributed(totalCouponPool, len, block.timestamp);
    }

    /// @notice Returns all current bondholder addresses.
    function getHolders() external view returns (address[] memory) {
        return _bondholders.values();
    }

    // ── Admin utilities ───────────────────────────────────────────────────────

    /// @notice Update bond price. Emits BondPriceUpdated.
    function setBondPrice(uint256 _price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit BondPriceUpdated(bondPrice, _price);
        bondPrice = _price;
    }

    /// @notice Unblock an investor with a stuck deposit request.
    function resetDepositRequest(address investor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositRequests[investorDepositRequestId[investor]].claimed = true;
        hasPendingDeposit[investor] = false;
    }

    /// @notice Unblock an investor with a stuck redemption request.
    function resetRedeemRequest(address investor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        redeemRequests[investorRedeemRequestId[investor]].claimed = true;
        hasPendingRedeem[investor] = false;
    }

    /// @notice Recover non-IDRP tokens (or IDRP if emergency flag is set).
    function sweepToken(address token, address to, uint256 amount)
        external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (token == address(idrp) && !emergencyWithdrawIDRP) revert UseEmergencyFlag();
        IERC20(token).safeTransfer(to, amount);
        emit TokenSwept(token, to, amount);
    }

    /// @notice Two-step gate to allow IDRP recovery via sweepToken.
    function setEmergencyWithdrawIDRP(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyWithdrawIDRP = enabled;
    }
}
