// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "solmate/src/tokens/ERC20.sol";

/// @notice Demo / test token with a public faucet. Never deploy to mainnet.
contract MockERC20 is ERC20 {
    uint256 public immutable faucetAmount;

    constructor(string memory name, string memory symbol, uint8 decimals, uint256 _faucetAmount) ERC20(name, symbol, decimals) {
        faucetAmount = _faucetAmount;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function faucet() external {
        _mint(msg.sender, faucetAmount);
    }
}
