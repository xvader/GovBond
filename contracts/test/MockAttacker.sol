// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVault {
    function deposit(uint256 assets, address receiver, address controller) external returns (uint256);
    function redeem(uint256 shares, address receiver, address controller) external returns (uint256);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Reentrancy attacker for testing nonReentrant guards on GovBondVault.
contract MockAttacker {
    IVault public vault;
    IERC20 public idrp;
    uint256 public attackAssets;
    bool public attackOnDeposit;
    bool public attacked;

    constructor(address _vault, address _idrp) {
        vault = IVault(_vault);
        idrp = IERC20(_idrp);
    }

    function setAttack(uint256 assets, bool onDeposit) external {
        attackAssets = assets;
        attackOnDeposit = onDeposit;
        attacked = false;
    }

    /// @dev Called by vault's safeTransfer (IDRP transfer hook simulation).
    /// In practice, we test by calling deposit/redeem from within a receive() or
    /// a callback. Here we expose a direct reentrant call function.
    function attackDeposit() external {
        if (!attacked) {
            attacked = true;
            // Attempt reentrant deposit — should revert with ReentrancyGuardReentrantCall
            vault.deposit(attackAssets, address(this), address(this));
        }
    }

    function attackRedeem(uint256 shares) external {
        if (!attacked) {
            attacked = true;
            vault.redeem(shares, address(this), address(this));
        }
    }
}
