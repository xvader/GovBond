// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IIdentityRegistry {
    function isVerified(address investor) external view returns (bool);
}

interface IComplianceModule {
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);
}

contract GovBondToken is ERC20, ERC20Burnable, AccessControl, Pausable {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    IIdentityRegistry public identityRegistry;
    IComplianceModule public complianceModule;

    uint256 public immutable faceValueIDRP;
    uint256 public immutable maturityDate;
    uint256 public immutable couponRate;
    uint256 public maxSupply;

    mapping(address => bool) public frozen;

    bool private _forcedTransferActive;

    event IdentityRegistryAdded(address indexed registry);
    event ComplianceAdded(address indexed compliance);
    event TokensFrozen(address indexed investor, bool status);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount);

    constructor(
        string memory _name,
        string memory _symbol,
        address _identityRegistry,
        address _complianceModule,
        uint256 _maturityDate,
        uint256 _couponRate,
        uint256 _maxSupply,
        uint256 _faceValueIDRP
    ) ERC20(_name, _symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(AGENT_ROLE, msg.sender);
        _grantRole(COMPLIANCE_ROLE, msg.sender);

        identityRegistry = IIdentityRegistry(_identityRegistry);
        complianceModule = IComplianceModule(_complianceModule);
        maturityDate = _maturityDate;
        couponRate = _couponRate;
        maxSupply = _maxSupply;
        faceValueIDRP = _faceValueIDRP;

        emit IdentityRegistryAdded(_identityRegistry);
        emit ComplianceAdded(_complianceModule);
    }

    function decimals() public pure override returns (uint8) { return 0; }

    function redeemable() external view returns (bool) {
        return block.timestamp >= maturityDate;
    }

    function mint(address to, uint256 amount) external onlyRole(AGENT_ROLE) {
        require(identityRegistry.isVerified(to), "Recipient not verified");
        require(totalSupply() + amount <= maxSupply, "Cap reached");
        _mint(to, amount);
    }

    function freeze(address investor, bool status) external onlyRole(AGENT_ROLE) {
        frozen[investor] = status;
        emit TokensFrozen(investor, status);
    }

    function forcedTransfer(address from, address to, uint256 amount) external onlyRole(AGENT_ROLE) returns (bool) {
        _forcedTransferActive = true;
        _transfer(from, to, amount);
        _forcedTransferActive = false;
        emit ForcedTransfer(from, to, amount);
        return true;
    }

    function resetForcedFlag() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _forcedTransferActive = false;
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
        if (_forcedTransferActive) {
            ERC20._update(from, to, amount);
            return;
        }
        if (from != address(0) && to != address(0)) {
            require(!paused(), "Token paused");
            require(!frozen[from], "Sender frozen");
            require(!frozen[to], "Recipient frozen");
            require(complianceModule.canTransfer(from, to, amount), "Compliance check failed");
        }
        super._update(from, to, amount);
    }
}
