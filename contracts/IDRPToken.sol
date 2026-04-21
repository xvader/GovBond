// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract IDRPToken is ERC20, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    bool public testnetFaucetEnabled;
    mapping(address => uint256) public lastFaucetTime;

    event FaucetDisabled();

    constructor() ERC20("Indonesian Rupiah", "IDRP") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        testnetFaucetEnabled = true;
    }

    function decimals() public pure override returns (uint8) { return 2; }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }

    function faucet(address to) external {
        require(testnetFaucetEnabled, "Faucet disabled");
        require(block.timestamp >= lastFaucetTime[to] + 24 hours, "Cooldown");
        lastFaucetTime[to] = block.timestamp;
        _mint(to, 100_000_000); // Rp 1,000,000.00
    }

    function disableFaucet() external onlyRole(DEFAULT_ADMIN_ROLE) {
        testnetFaucetEnabled = false;
        emit FaucetDisabled();
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0)) require(!paused(), "Token paused");
        super._update(from, to, amount);
    }
}
