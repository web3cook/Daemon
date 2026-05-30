// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20}   from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}  from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestERC20 is ERC20 {
    uint8 private _dec;

    constructor(string memory name_, string memory symbol_, uint8 dec_) ERC20(name_, symbol_) {
        _dec = dec_;
    }

    function decimals() public view override returns (uint8) { return _dec; }

    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract TestAggregator {
    function swap(
        address spendToken,
        uint256 spendAmount,
        address outputToken,
        address recipient,
        uint256 outputAmount
    ) external {
        IERC20(spendToken).transferFrom(msg.sender, address(this), spendAmount);
        IERC20(outputToken).transfer(recipient, outputAmount);
    }
}
