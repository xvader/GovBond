// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IIdentityRegistryForCompliance {
    function isVerified(address investor) external view returns (bool);
    function investorCountry(address investor) external view returns (string memory);
}

interface IGovBondTokenForCompliance {
    function frozen(address investor) external view returns (bool);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract ComplianceModule is AccessControl {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    IIdentityRegistryForCompliance public identityRegistry;
    IGovBondTokenForCompliance public bondToken;

    uint256 public maxHoldingBps;

    mapping(bytes2 => bool) public blockedCountries;

    event CountryBlocked(bytes2 indexed country, bool blocked);

    constructor(address _identityRegistry) {
        require(_identityRegistry != address(0), "Registry not set");
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

    function blockCountry(bytes2 countryCode, bool blocked) external onlyRole(COMPLIANCE_ROLE) {
        blockedCountries[countryCode] = blocked;
        emit CountryBlocked(countryCode, blocked);
    }

    function canTransfer(address from, address to, uint256 amount) external view returns (bool) {
        if (from == address(0)) {
            // minting: only check recipient
            if (!identityRegistry.isVerified(to)) return false;
            if (address(bondToken) != address(0) && bondToken.frozen(to)) return false;
            return true;
        }

        if (!identityRegistry.isVerified(from)) return false;
        if (!identityRegistry.isVerified(to)) return false;
        if (address(bondToken) != address(0)) {
            if (bondToken.frozen(from)) return false;
            if (bondToken.frozen(to)) return false;
        }

        bytes2 fromCountry = bytes2(bytes(identityRegistry.investorCountry(from)));
        bytes2 toCountry   = bytes2(bytes(identityRegistry.investorCountry(to)));
        if (blockedCountries[fromCountry] || blockedCountries[toCountry]) return false;

        if (maxHoldingBps > 0 && address(bondToken) != address(0)) {
            uint256 totalSupply = bondToken.totalSupply();
            if (totalSupply > 0) {
                uint256 newBalance = bondToken.balanceOf(to) + amount;
                // Safe: assumes totalSupply < type(uint256).max / 10000
                if (newBalance > (maxHoldingBps * totalSupply) / 10000) return false;
            }
        }
        return true;
    }
}
