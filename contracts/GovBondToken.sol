// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IIdentityRegistry {
    function isVerified(address investor) external view returns (bool);
}

interface IComplianceModule {
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);
}

contract GovBondToken is ERC20, AccessControl, Pausable {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    IIdentityRegistry public identityRegistry;
    IComplianceModule public complianceModule;

    uint256 public immutable faceValue = 1_000_000;
    uint256 public immutable maturityDate;
    uint256 public immutable couponRate; // basis points

    mapping(address => bool) public frozen;

    event IdentityRegistryAdded(address indexed registry);
    event ComplianceAdded(address indexed compliance);
    event TokensFrozen(address indexed investor, bool status);

    constructor(
        address _identityRegistry,
        address _complianceModule,
        uint256 _maturityDate,
        uint256 _couponRate,
        uint256 _initialSupply
    ) ERC20("Palembang Municipal Bond 2025", "PMB25") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(AGENT_ROLE, msg.sender);
        _grantRole(COMPLIANCE_ROLE, msg.sender);

        identityRegistry = IIdentityRegistry(_identityRegistry);
        complianceModule = IComplianceModule(_complianceModule);
        maturityDate = _maturityDate;
        couponRate = _couponRate;

        emit IdentityRegistryAdded(_identityRegistry);
        emit ComplianceAdded(_complianceModule);

        if (_initialSupply > 0) _mint(msg.sender, _initialSupply);
    }

    function decimals() public pure override returns (uint8) { return 18; }

    function mint(address to, uint256 amount) external onlyRole(AGENT_ROLE) {
        require(identityRegistry.isVerified(to), "Recipient not verified");
        _mint(to, amount);
    }

    function freeze(address investor, bool status) external onlyRole(AGENT_ROLE) {
        frozen[investor] = status;
        emit TokensFrozen(investor, status);
    }

    function forcedTransfer(address from, address to, uint256 amount) external onlyRole(AGENT_ROLE) returns (bool) {
        _transfer(from, to, amount);
        return true;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function setIdentityRegistry(address _registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        identityRegistry = IIdentityRegistry(_registry);
        emit IdentityRegistryAdded(_registry);
    }

    function setComplianceModule(address _compliance) external onlyRole(DEFAULT_ADMIN_ROLE) {
        complianceModule = IComplianceModule(_compliance);
        emit ComplianceAdded(_compliance);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            require(!paused(), "Token paused");
            require(!frozen[from], "Sender frozen");
            require(!frozen[to], "Recipient frozen");
            require(complianceModule.canTransfer(from, to, amount), "Compliance check failed");
        }
        super._update(from, to, amount);
    }
}
