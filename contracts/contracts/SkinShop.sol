// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SkinShop — cosmetic-only Shardfall skins (ERC-1155). Skins never change stats.
contract SkinShop is ERC1155, Ownable {
    uint256 public constant PRICE = 0.05 ether;
    uint256 public constant SKIN_COUNT = 3; // ids 1..3 (id 0 is the free default skin)

    address public treasury;

    event SkinBought(address indexed buyer, uint256 indexed id);

    error UnknownSkin();
    error WrongPrice();
    error TransferFailed();

    constructor(address treasury_, string memory uri_) ERC1155(uri_) Ownable(msg.sender) {
        treasury = treasury_;
    }

    function buySkin(uint256 id) external payable {
        if (id == 0 || id > SKIN_COUNT) revert UnknownSkin();
        if (msg.value != PRICE) revert WrongPrice();
        _mint(msg.sender, id, 1, "");
        emit SkinBought(msg.sender, id);
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
    }

    function withdraw() external onlyOwner {
        (bool ok, ) = treasury.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }
}
