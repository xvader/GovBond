// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IIdentityRegistryForCompliance {
    function isVerified(address investor) external view returns (bool);
}

interface IGovBondTokenForCompliance {
    function frozen(address investor) external view returns (bool);
    function paused() external view returns (bool);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract ComplianceModule is AccessControl {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    IIdentityRegistryForCompliance public identityRegistry;
    IGovBondTokenForCompliance public bondToken;

    // 0 = no limit
    uint256 public maxHoldingBps; // basis points of total supply, e.g. 1000 = 10%

    constructor(address _identityRegistry) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(COMPLIANCE_ROLE, msg.sender);
        identityRegistry = IIdentityRegistryForCompliance(_identityRegistry);
    }

    function setBondToken(address _bondToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bondToken = IGovBondTokenForCompliance(_bondToken);
    }

    function setMaxHoldingBps(uint256 _bps) external onlyRole(COMPLIANCE_ROLE) {
        maxHoldingBps = _bps;
    }

    function canTransfer(address from, address to, uint256 amount) external view returns (bool) {
        // Minting from zero address: only check recipient
        if (from != address(0)) {
            if (!identityRegistry.isVerified(from)) return false;
            if (address(bondToken) != address(0) && bondToken.frozen(from)) return false;
        }
        if (!identityRegistry.isVerified(to)) return false;
        if (address(bondToken) != address(0) && bondToken.frozen(to)) return false;

        if (maxHoldingBps > 0 && address(bondToken) != address(0)) {
            uint256 totalSupply = bondToken.totalSupply();
            if (totalSupply > 0) {
                uint256 newBalance = bondToken.balanceOf(to) + amount;
                if (newBalance * 10000 > maxHoldingBps * totalSupply) return false;
            }
        }
        return true;
    }
}
