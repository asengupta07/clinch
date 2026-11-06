// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";

import {ClinchLaunch} from "../src/ClinchLaunch.sol";
import {HumanGate, MockWorldID, IWorldID, AttestedWorldID} from "../src/HumanGate.sol";
import {ClinchFixture} from "./utils/ClinchFixture.sol";

contract HumanGateTest is ClinchFixture {
    MockWorldID world;
    HumanGate gate;
    MockERC20 usdc;
    MockERC20 sale;
    address issuer = makeAddr("issuer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address aliceSybil = makeAddr("aliceSybil");

    uint256 constant ROOT = 42;
    uint256 constant CAP = 1_000e6;

    function setUp() public {
        _deployClinch();
        world = new MockWorldID();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        sale = new MockERC20("Sale", "SALE", 18);
        gate = new HumanGate(IWorldID(address(world)), ERC20(address(usdc)), "app_clinch", "clinch-launch", CAP);
        gate.setVenue(address(manager), true);
        gate.setVenue(address(hook), true);
        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);
        usdc.mint(aliceSybil, 10_000e6);
    }

    function _proof(address wallet, uint256 nullifier) internal view returns (uint256[8] memory p) {
        p[0] = world.commitment(ROOT, 1, gate.signalHashOf(wallet), nullifier, gate.externalNullifierHash());
    }

    function _verify(address wallet, uint256 nullifier) internal {
        uint256[8] memory p = _proof(wallet, nullifier);
        vm.prank(wallet);
        gate.verify(ROOT, nullifier, p);
    }

    function _deposit(address who, uint256 amt) internal {
        vm.startPrank(who);
        usdc.approve(address(gate), amt);
        gate.deposit(amt);
        vm.stopPrank();
    }

    function test_Metadata() public view {
        assertEq(gate.symbol(), "hUSDC");
        assertEq(gate.decimals(), 6);
    }

    function test_VerifyDepositRedeem() public {
        _verify(alice, 111);
        assertEq(gate.humanOf(alice), 111);
        _deposit(alice, 600e6);
        assertEq(gate.balanceOf(alice), 600e6);
        assertEq(gate.remaining(alice), 400e6);
        vm.prank(alice);
        gate.redeem(100e6);
        assertEq(usdc.balanceOf(alice), 10_000e6 - 500e6);
        // redeeming does not restore the cap
        assertEq(gate.remaining(alice), 400e6);
    }

    function test_RejectsUnverifiedDeposit() public {
        vm.startPrank(bob);
        usdc.approve(address(gate), 1e6);
        vm.expectRevert(HumanGate.NotVerified.selector);
        gate.deposit(1e6);
        vm.stopPrank();
    }

    function test_RejectsReusedNullifier() public {
        _verify(alice, 111);
        uint256[8] memory p = _proof(aliceSybil, 111);
        vm.prank(aliceSybil);
        vm.expectRevert(HumanGate.NullifierUsed.selector);
        gate.verify(ROOT, 111, p);
    }

    function test_RejectsProofForAnotherWallet() public {
        // alice's proof (signal = alice) replayed by another wallet
        uint256[8] memory p = _proof(alice, 111);
        vm.prank(bob);
        vm.expectRevert(MockWorldID.InvalidProof.selector);
        gate.verify(ROOT, 111, p);
    }

    function test_RejectsBadProof() public {
        uint256[8] memory p;
        vm.prank(alice);
        vm.expectRevert(MockWorldID.InvalidProof.selector);
        gate.verify(ROOT, 111, p);
    }

    function test_RejectsSecondVerifyFromSameWallet() public {
        _verify(alice, 111);
        uint256[8] memory p = _proof(alice, 222);
        vm.prank(alice);
        vm.expectRevert(HumanGate.AlreadyVerified.selector);
        gate.verify(ROOT, 222, p);
    }

    function test_CapIsPerHuman() public {
        _verify(alice, 111);
        _deposit(alice, CAP);
        vm.startPrank(alice);
        usdc.approve(address(gate), 1);
        vm.expectRevert(HumanGate.OverCap.selector);
        gate.deposit(1);
        vm.stopPrank();
    }

    function test_NotTransferableBetweenWallets() public {
        _verify(alice, 111);
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(HumanGate.NotTransferable.selector);
        gate.transfer(aliceSybil, 1);
        vm.prank(alice);
        gate.approve(aliceSybil, 1);
        vm.prank(aliceSybil);
        vm.expectRevert(HumanGate.NotTransferable.selector);
        gate.transferFrom(alice, aliceSybil, 1);
    }

    function test_OnlyOwnerSetsVenues() public {
        vm.prank(alice);
        vm.expectRevert(HumanGate.NotOwner.selector);
        gate.setVenue(alice, true);
    }

    /// The comparison arm end to end: a Clinch launch whose quote token is hUSDC.
    function test_GatedLaunchLifecycle() public {
        ClinchLaunch.Params memory p;
        p.saleToken = address(sale);
        p.quoteToken = address(gate);
        p.supply = 10_000e18;
        p.lpTokens = 2_000e18;
        p.lpQuoteBps = 4000;
        p.reservePrice = 0.1e18 * 1e6 / 1e18;
        p.maxPrice = 1e18 * 1e6 / 1e18;
        p.eps = 1e16;
        p.endTime = uint64(block.timestamp + 1 days);
        p.rescueDelay = 1 days;
        p.maxBids = 40;
        p.minBid = 10e6;
        p.poolCfg = _cfg();
        p.poolCfg.minOrder0 = 1;
        p.poolCfg.minOrder1 = 1;

        sale.mint(issuer, p.supply + p.lpTokens);
        vm.startPrank(issuer);
        sale.approve(address(factory), type(uint256).max);
        // the launch address is deterministic, so it can be a venue before it exists
        address predicted = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        vm.stopPrank();
        gate.setVenue(predicted, true);
        vm.prank(issuer);
        ClinchLaunch l = factory.createLaunch(p);
        assertEq(address(l), predicted);

        _verify(alice, 111);
        _verify(bob, 222);
        _deposit(alice, CAP);
        _deposit(bob, 500e6);

        vm.startPrank(alice);
        gate.approve(address(l), CAP);
        l.bid(0.6e18 * 1e6 / 1e18, uint128(CAP));
        vm.stopPrank();
        vm.startPrank(bob);
        gate.approve(address(l), 500e6);
        l.bid(0.4e18 * 1e6 / 1e18, 500e6);
        vm.stopPrank();

        // a wallet with no proof cannot get quote tokens, so it cannot bid
        vm.startPrank(aliceSybil);
        vm.expectRevert();
        l.bid(0.6e18 * 1e6 / 1e18, 10e6);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        l.settle();
        assertTrue(l.poolSeeded());

        l.claim(0);
        l.claim(1);
        assertGt(sale.balanceOf(alice), 0);
        assertGt(sale.balanceOf(bob), 0);
        vm.prank(issuer);
        l.issuerWithdraw();

        // everyone exits to the real token
        uint256 refund = gate.balanceOf(alice);
        vm.prank(alice);
        gate.redeem(refund);
        uint256 proceeds = gate.balanceOf(issuer);
        assertGt(proceeds, 0);
        vm.prank(issuer);
        gate.redeem(proceeds);
        assertEq(usdc.balanceOf(issuer), proceeds);
    }
}

contract AttestedWorldIDTest is ClinchFixture {
    AttestedWorldID verifier;
    HumanGate gate;
    MockERC20 usdc;
    uint256 attesterPk = 0xA77E57;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        verifier = new AttestedWorldID(vm.addr(attesterPk));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        gate = new HumanGate(IWorldID(address(verifier)), ERC20(address(usdc)), "app_x", "clinch-human-launch", 1_000e6);
    }

    function _sig(uint256 pk, address wallet, uint256 nullifier) internal view returns (uint256[8] memory p) {
        bytes32 d = verifier.digest(gate.signalHashOf(wallet), nullifier, gate.externalNullifierHash());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        p[0] = uint256(r);
        p[1] = uint256(s);
        p[2] = v;
    }

    function test_AcceptsAttestedProof() public {
        uint256[8] memory p = _sig(attesterPk, alice, 7);
        vm.prank(alice);
        gate.verify(0, 7, p);
        assertEq(gate.humanOf(alice), 7);
    }

    function test_RejectsWrongSigner() public {
        uint256[8] memory p = _sig(0xBAD, alice, 7);
        vm.prank(alice);
        vm.expectRevert(AttestedWorldID.InvalidProof.selector);
        gate.verify(0, 7, p);
    }

    function test_RejectsAttestationForAnotherWallet() public {
        uint256[8] memory p = _sig(attesterPk, alice, 7);
        vm.prank(bob);
        vm.expectRevert(AttestedWorldID.InvalidProof.selector);
        gate.verify(0, 7, p);
    }

    function test_SecondWalletOfSameHumanRejected() public {
        uint256[8] memory p = _sig(attesterPk, alice, 7);
        vm.prank(alice);
        gate.verify(0, 7, p);
        uint256[8] memory q = _sig(attesterPk, bob, 7);
        vm.prank(bob);
        vm.expectRevert(HumanGate.NullifierUsed.selector);
        gate.verify(0, 7, q);
    }
}
