// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract IdentityRegistry is AccessControl {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    mapping(address => bool) public isVerified;
    mapping(address => string) public investorCountry;
    mapping(address => uint256) public verifiedAt;

    event InvestorRegistered(address indexed investor, string country);
    event InvestorRemoved(address indexed investor);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(AGENT_ROLE, msg.sender);
    }

    function registerInvestor(address investor, string calldata country) external onlyRole(AGENT_ROLE) {
        isVerified[investor] = true;
        investorCountry[investor] = country;
        verifiedAt[investor] = block.timestamp;
        emit InvestorRegistered(investor, country);
    }

    function removeInvestor(address investor) external onlyRole(AGENT_ROLE) {
        isVerified[investor] = false;
        emit InvestorRemoved(investor);
    }

    function batchRegister(address[] calldata investors, string[] calldata countries) external onlyRole(AGENT_ROLE) {
        require(investors.length == countries.length, "Length mismatch");
        require(investors.length <= 200, "Batch too large");
        for (uint256 i = 0; i < investors.length; i++) {
            isVerified[investors[i]] = true;
            investorCountry[investors[i]] = countries[i];
            verifiedAt[investors[i]] = block.timestamp;
            emit InvestorRegistered(investors[i], countries[i]);
        }
    }
}
