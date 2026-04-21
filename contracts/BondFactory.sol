// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./GovBondToken.sol";
import "./GovBondVault.sol";

contract BondFactory is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    address public immutable idrpToken;
    address public immutable identityRegistry;
    address public immutable complianceModule;

    struct BondRecord {
        address bondToken;
        address vault;
        string name;
        string symbol;
        uint256 faceValueIDRP;
        uint256 couponRate;
        uint256 maturityDate;
        uint256 maxSupply;
        uint256 deployedAt;
        address deployer;
    }

    BondRecord[] public bonds;
    mapping(address => bool) public isBondToken;
    mapping(address => bool) public isVault;

    event BondDeployed(
        address indexed bondToken,
        address indexed vault,
        address indexed issuer,
        string symbol,
        uint256 maturityDate
    );

    constructor(address _idrpToken, address _identityRegistry, address _complianceModule) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ISSUER_ROLE, msg.sender);
        idrpToken = _idrpToken;
        identityRegistry = _identityRegistry;
        complianceModule = _complianceModule;
    }

    /// @notice Deploy a new GovBondToken + GovBondVault pair.
    /// @dev After calling, the IDRP admin must call idrpToken.grantRole(MINTER_ROLE, vault).
    function deployBond(
        string calldata name,
        string calldata symbol,
        uint256 faceValueIDRP,
        uint256 couponRateBps,
        uint256 maturityMonths,
        uint256 maxSupplyUnits
    ) external onlyRole(ISSUER_ROLE) returns (address bondToken, address vault) {
        require(bytes(name).length > 0 && bytes(name).length <= 64, "Invalid name");
        require(bytes(symbol).length >= 2 && bytes(symbol).length <= 8, "Invalid symbol");
        require(faceValueIDRP >= 100, "Face value too small");
        require(couponRateBps <= 5000, "Coupon > 50%");
        require(maturityMonths >= 1 && maturityMonths <= 120, "Invalid maturity");
        require(maxSupplyUnits >= 1 && maxSupplyUnits <= 1_000_000, "Invalid supply");

        uint256 maturityDate = block.timestamp + maturityMonths * 30 days;

        GovBondToken token = new GovBondToken(
            name, symbol,
            identityRegistry,
            complianceModule,
            maturityDate,
            couponRateBps,
            maxSupplyUnits,
            faceValueIDRP
        );
        bondToken = address(token);

        GovBondVault v = new GovBondVault(bondToken, idrpToken, faceValueIDRP);
        vault = address(v);

        bytes32 AGENT_ROLE = keccak256("AGENT_ROLE");
        token.grantRole(AGENT_ROLE, vault);
        token.grantRole(AGENT_ROLE, msg.sender);

        isBondToken[bondToken] = true;
        isVault[vault] = true;

        bonds.push(BondRecord({
            bondToken: bondToken,
            vault: vault,
            name: name,
            symbol: symbol,
            faceValueIDRP: faceValueIDRP,
            couponRate: couponRateBps,
            maturityDate: maturityDate,
            maxSupply: maxSupplyUnits,
            deployedAt: block.timestamp,
            deployer: msg.sender
        }));

        emit BondDeployed(bondToken, vault, msg.sender, symbol, maturityDate);
    }

    function getBondsCount() external view returns (uint256) {
        return bonds.length;
    }

    function getAllBonds() external view returns (BondRecord[] memory) {
        return bonds;
    }

    function getBond(uint256 index) external view returns (BondRecord memory) {
        return bonds[index];
    }

    function getBondByToken(address _bondToken) external view returns (BondRecord memory) {
        for (uint256 i = 0; i < bonds.length; i++) {
            if (bonds[i].bondToken == _bondToken) return bonds[i];
        }
        revert("Bond not found");
    }
}
