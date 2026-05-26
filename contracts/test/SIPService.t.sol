// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SIPService, SwapParams} from "../src/SIPService.sol";

// ── Events (inside SIPService, redeclared here for vm.expectEmit) ────────────

event FeeUpdated(uint256 indexed old, uint256 indexed newFee);
event MaxFeeAmountUpdated(uint256 indexed old, uint256 indexed newMax);
event AggregatorUpdated(address indexed oldAggregator, address indexed newAggregator);
event TokenAdded(address indexed token);
event TokenRemoved(address indexed token);
event SwapExecuted(
    address indexed subscriber,
    address indexed spendToken,
    address indexed outputToken,
    uint256 amountSpent,
    uint256 amountReceived,
    uint256 fee
);
event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
event Swept(address indexed token, address indexed to, uint256 amount);

// ── Mocks ────────────────────────────────────────────────────────────────────

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

// Simulates a DEX aggregator. On swap(): optionally captures mid-swap allowance,
// then delivers outAmount of outToken to outRecipient.
contract MockAggregator {
    bool    public shouldFail;
    address public outToken;
    address public outRecipient;
    uint256 public outAmount;
    // Set these to capture the allowance that SIPService grants before calling
    address public captureSpend;
    address public captureSip;
    uint256 public capturedAllowance;

    function setOut(address token, address recipient, uint256 amount) external {
        outToken     = token;
        outRecipient = recipient;
        outAmount    = amount;
    }

    function setCaptureAllowance(address spendToken, address sipService) external {
        captureSpend = spendToken;
        captureSip   = sipService;
    }

    function setShouldFail(bool fail) external { shouldFail = fail; }

    function swap() external {
        if (shouldFail) revert("fail");
        if (captureSpend != address(0)) {
            capturedAllowance = MockERC20(captureSpend).allowance(captureSip, address(this));
        }
        if (outAmount > 0) {
            MockERC20(outToken).transfer(outRecipient, outAmount);
        }
    }
}

// Deployed as SIPService's `subscriptions` address so onlySubscriptions passes.
// On swap() it attempts to re-enter execute() — nonReentrant should block it.
contract ReentrantAggregator {
    SIPService public sip;
    address    public subscriber;
    address    public spendToken;
    uint256    public amount;
    bytes      public params;

    function setSip(address _sip)                          external { sip       = SIPService(_sip); }
    function setSubscriber(address _s)                     external { subscriber = _s; }
    function setSpendToken(address _t)                     external { spendToken = _t; }
    function setAmount(uint256 _a)                         external { amount     = _a; }
    function setParams(bytes calldata _p)                  external { params     = _p; }

    function swap() external {
        sip.execute(subscriber, spendToken, amount, params);
    }
}

// ── Test contract ─────────────────────────────────────────────────────────────

contract SIPServiceTest is Test {
    SIPService     sip;
    MockERC20      spendToken;
    MockERC20      outToken;
    MockAggregator aggregator;

    address owner         = makeAddr("owner");
    address subscriptions = makeAddr("subscriptions");
    address treasury      = makeAddr("treasury");
    address subscriber    = makeAddr("subscriber");
    address stranger      = makeAddr("stranger");

    uint256 constant MAX_FEE = 500;       // 5 %
    uint256 constant AMOUNT  = 1_000e6;
    uint256 constant OUT_AMT = 900e6;

    // ── Setup ────────────────────────────────────────────────────────────────

    function setUp() public {
        spendToken = new MockERC20();
        outToken   = new MockERC20();
        aggregator = new MockAggregator();

        vm.prank(owner);
        sip = new SIPService(subscriptions, treasury, MAX_FEE, address(aggregator));

        vm.prank(owner);
        sip.addToken(address(outToken));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _swapData() internal view returns (bytes memory) {
        return abi.encodeWithSelector(MockAggregator.swap.selector);
    }

    function _params(uint256 minOut) internal view returns (bytes memory) {
        return abi.encode(SwapParams({
            outputToken:     address(outToken),
            minOutputAmount: minOut,
            swapData:        _swapData()
        }));
    }

    // Configures aggregator to deliver outAmount and pre-mints tokens to it.
    function _prepareSwap(uint256 outAmount) internal {
        aggregator.setOut(address(outToken), address(sip), outAmount);
        outToken.mint(address(aggregator), outAmount);
    }

    // Mints spendTokens to SIPService (replicates Subscriptions' transferFrom),
    // then calls execute() as the subscriptions address.
    function _execute(uint256 amount, bytes memory p) internal returns (bool) {
        spendToken.mint(address(sip), amount);
        vm.prank(subscriptions);
        return sip.execute(subscriber, address(spendToken), amount, p);
    }

    // One-shot: prepare aggregator, execute, return result.
    function _fullExec(uint256 amount, uint256 outAmount, uint256 minOut) internal returns (bool) {
        _prepareSwap(outAmount);
        return _execute(amount, _params(minOut));
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    function test_constructor_revertsOnZeroSubscriptions() public {
        vm.expectRevert(SIPService.ZeroAddress.selector);
        new SIPService(address(0), treasury, MAX_FEE, address(aggregator));
    }

    function test_constructor_revertsOnZeroTreasury() public {
        vm.expectRevert(SIPService.ZeroAddress.selector);
        new SIPService(subscriptions, address(0), MAX_FEE, address(aggregator));
    }

    function test_constructor_revertsOnZeroAggregator() public {
        vm.expectRevert(SIPService.ZeroAddress.selector);
        new SIPService(subscriptions, treasury, MAX_FEE, address(0));
    }

    function test_constructor_setsState() public view {
        assertEq(sip.subscriptions(), subscriptions);
        assertEq(sip.MAX_FEE(),       MAX_FEE);
        assertEq(sip.aggregator(),    address(aggregator));
        assertEq(sip.treasury(),      treasury);
    }

    function test_constructor_feeAndCapAreZeroAtDeploy() public view {
        assertEq(sip.fee(),          0);
        assertEq(sip.maxFeeAmount(), 0);
    }

    // ── setFee ───────────────────────────────────────────────────────────────

    function test_setFee_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        sip.setFee(100);
    }

    function test_setFee_revertsFeeTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SIPService.FeeTooHigh.selector, MAX_FEE + 1, MAX_FEE));
        sip.setFee(MAX_FEE + 1);
    }

    function test_setFee_acceptsExactlyMaxFee() public {
        vm.prank(owner);
        sip.setFee(MAX_FEE);
        assertEq(sip.fee(), MAX_FEE);
    }

    function test_setFee_updatesFee() public {
        vm.prank(owner);
        sip.setFee(200);
        assertEq(sip.fee(), 200);
    }

    function test_setFee_emitsFeeUpdated() public {
        vm.prank(owner);
        sip.setFee(100);
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit FeeUpdated(100, 200);
        sip.setFee(200);
    }

    // ── setMaxFeeAmount ──────────────────────────────────────────────────────

    function test_setMaxFeeAmount_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        sip.setMaxFeeAmount(1e6);
    }

    function test_setMaxFeeAmount_updatesState() public {
        vm.prank(owner);
        sip.setMaxFeeAmount(5e6);
        assertEq(sip.maxFeeAmount(), 5e6);
    }

    function test_setMaxFeeAmount_emitsEvent() public {
        vm.prank(owner);
        sip.setMaxFeeAmount(3e6);
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit MaxFeeAmountUpdated(3e6, 7e6);
        sip.setMaxFeeAmount(7e6);
    }

    function test_setMaxFeeAmount_zeroDisablesCap() public {
        vm.prank(owner);
        sip.setMaxFeeAmount(1e6);
        vm.prank(owner);
        sip.setMaxFeeAmount(0);
        assertEq(sip.maxFeeAmount(), 0);
    }

    // ── setAggregator ────────────────────────────────────────────────────────

    function test_setAggregator_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        sip.setAggregator(makeAddr("agg"));
    }

    function test_setAggregator_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(SIPService.ZeroAddress.selector);
        sip.setAggregator(address(0));
    }

    function test_setAggregator_updatesAggregator() public {
        address newAgg = makeAddr("newAgg");
        vm.prank(owner);
        sip.setAggregator(newAgg);
        assertEq(sip.aggregator(), newAgg);
    }

    function test_setAggregator_emitsAggregatorUpdated() public {
        address newAgg = makeAddr("newAgg");
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit AggregatorUpdated(address(aggregator), newAgg);
        sip.setAggregator(newAgg);
    }

    // ── addToken ─────────────────────────────────────────────────────────────

    function test_addToken_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        sip.addToken(makeAddr("tkn"));
    }

    function test_addToken_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(SIPService.ZeroAddress.selector);
        sip.addToken(address(0));
    }

    function test_addToken_revertsIfAlreadyWhitelisted() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SIPService.TokenAlreadyWhitelisted.selector, address(outToken)));
        sip.addToken(address(outToken));
    }

    function test_addToken_setsFlag() public {
        address newTkn = makeAddr("newTkn");
        vm.prank(owner);
        sip.addToken(newTkn);
        assertTrue(sip.outputTokens(newTkn));
    }

    function test_addToken_emitsTokenAdded() public {
        address newTkn = makeAddr("newTkn");
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit TokenAdded(newTkn);
        sip.addToken(newTkn);
    }

    // ── removeToken ──────────────────────────────────────────────────────────

    function test_removeToken_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        sip.removeToken(address(outToken));
    }

    function test_removeToken_revertsIfNotWhitelisted() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SIPService.TokenNotWhitelisted.selector, stranger));
        sip.removeToken(stranger);
    }

    function test_removeToken_clearsFlag() public {
        vm.prank(owner);
        sip.removeToken(address(outToken));
        assertFalse(sip.outputTokens(address(outToken)));
    }

    function test_removeToken_emitsTokenRemoved() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit TokenRemoved(address(outToken));
        sip.removeToken(address(outToken));
    }

    function test_removeToken_roundTrip() public {
        vm.startPrank(owner);
        sip.removeToken(address(outToken));
        assertFalse(sip.outputTokens(address(outToken)));
        sip.addToken(address(outToken));
        assertTrue(sip.outputTokens(address(outToken)));
        vm.stopPrank();
    }

    // ── setTreasury ──────────────────────────────────────────────────────────

    function test_setTreasury_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        sip.setTreasury(makeAddr("t"));
    }

    function test_setTreasury_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(SIPService.ZeroAddress.selector);
        sip.setTreasury(address(0));
    }

    function test_setTreasury_updatesTreasury() public {
        address newT = makeAddr("newTreasury");
        vm.prank(owner);
        sip.setTreasury(newT);
        assertEq(sip.treasury(), newT);
    }

    function test_setTreasury_emitsTreasuryUpdated() public {
        address newT = makeAddr("newTreasury");
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit TreasuryUpdated(treasury, newT);
        sip.setTreasury(newT);
    }

    // ── sweep ────────────────────────────────────────────────────────────────

    function test_sweep_revertsIfNotOwner() public {
        spendToken.mint(address(sip), 100e6);
        vm.prank(stranger);
        vm.expectRevert();
        sip.sweep(address(spendToken), stranger);
    }

    function test_sweep_revertsOnZeroToAddress() public {
        spendToken.mint(address(sip), 100e6);
        vm.prank(owner);
        vm.expectRevert(SIPService.ZeroAddress.selector);
        sip.sweep(address(spendToken), address(0));
    }

    function test_sweep_revertsOnZeroBalance() public {
        vm.prank(owner);
        vm.expectRevert(SIPService.ZeroAmount.selector);
        sip.sweep(address(spendToken), owner);
    }

    function test_sweep_transfersFullBalance() public {
        spendToken.mint(address(sip), 500e6);
        vm.prank(owner);
        sip.sweep(address(spendToken), owner);
        assertEq(spendToken.balanceOf(owner),        500e6);
        assertEq(spendToken.balanceOf(address(sip)), 0);
    }

    function test_sweep_emitsSwept() public {
        spendToken.mint(address(sip), 77e6);
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit Swept(address(spendToken), owner, 77e6);
        sip.sweep(address(spendToken), owner);
    }

    // ── pause / unpause ──────────────────────────────────────────────────────

    function test_pause_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        sip.pause();
    }

    function test_unpause_revertsIfNotOwner() public {
        vm.prank(owner);
        sip.pause();
        vm.prank(stranger);
        vm.expectRevert();
        sip.unpause();
    }

    function test_execute_revertsWhenPaused() public {
        _prepareSwap(OUT_AMT);
        vm.prank(owner);
        sip.pause();
        spendToken.mint(address(sip), AMOUNT);
        vm.prank(subscriptions);
        vm.expectRevert();
        sip.execute(subscriber, address(spendToken), AMOUNT, _params(1));
    }

    function test_execute_worksAfterUnpause() public {
        vm.startPrank(owner);
        sip.pause();
        sip.unpause();
        vm.stopPrank();
        assertTrue(_fullExec(AMOUNT, OUT_AMT, 1));
    }

    // ── execute() — access control & validation ───────────────────────────────

    function test_execute_revertsIfNotSubscriptions() public {
        spendToken.mint(address(sip), AMOUNT);
        vm.prank(stranger);
        vm.expectRevert(SIPService.NotSubscriptions.selector);
        sip.execute(subscriber, address(spendToken), AMOUNT, _params(1));
    }

    function test_execute_revertsOnZeroAmount() public {
        vm.prank(subscriptions);
        vm.expectRevert(SIPService.ZeroAmount.selector);
        sip.execute(subscriber, address(spendToken), 0, _params(1));
    }

    function test_execute_revertsTokenNotWhitelisted() public {
        address badToken = makeAddr("badToken");
        bytes memory p = abi.encode(SwapParams({
            outputToken:     badToken,
            minOutputAmount: 1,
            swapData:        _swapData()
        }));
        spendToken.mint(address(sip), AMOUNT);
        vm.prank(subscriptions);
        vm.expectRevert(abi.encodeWithSelector(SIPService.TokenNotWhitelisted.selector, badToken));
        sip.execute(subscriber, address(spendToken), AMOUNT, p);
    }

    function test_execute_revertsOnZeroMinOutputAmount() public {
        spendToken.mint(address(sip), AMOUNT);
        vm.prank(subscriptions);
        vm.expectRevert(SIPService.ZeroAmount.selector);
        sip.execute(subscriber, address(spendToken), AMOUNT, _params(0));
    }

    // ── execute() — fee accounting ────────────────────────────────────────────

    function test_execute_noTreasuryTransferWhenFeeIsZero() public {
        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(spendToken.balanceOf(treasury), 0);
    }

    function test_execute_correctFeeTransferredToTreasury() public {
        vm.prank(owner);
        sip.setFee(100); // 1%
        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(spendToken.balanceOf(treasury), AMOUNT * 100 / 10_000);
    }

    function test_execute_correctSwapAmountApprovedToAggregator() public {
        vm.prank(owner);
        sip.setFee(100); // 1%
        uint256 expectedSwap = AMOUNT - (AMOUNT * 100 / 10_000); // 990e6

        aggregator.setCaptureAllowance(address(spendToken), address(sip));
        _fullExec(AMOUNT, OUT_AMT, 1);

        assertEq(aggregator.capturedAllowance(), expectedSwap);
    }

    function test_execute_feeCapApplied() public {
        vm.startPrank(owner);
        sip.setFee(200);          // 2% → would be 20e6 on AMOUNT
        sip.setMaxFeeAmount(5e6); // cap at 5e6
        vm.stopPrank();

        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(spendToken.balanceOf(treasury), 5e6);
    }

    function test_execute_swapAmountReflectsCap() public {
        vm.startPrank(owner);
        sip.setFee(200);
        sip.setMaxFeeAmount(5e6);
        vm.stopPrank();

        aggregator.setCaptureAllowance(address(spendToken), address(sip));
        _fullExec(AMOUNT, OUT_AMT, 1);

        assertEq(aggregator.capturedAllowance(), AMOUNT - 5e6);
    }

    function test_execute_feeCapDisabledWhenZero() public {
        vm.startPrank(owner);
        sip.setFee(200);        // 2% → 20e6
        sip.setMaxFeeAmount(0); // no cap
        vm.stopPrank();

        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(spendToken.balanceOf(treasury), AMOUNT * 200 / 10_000);
    }

    function test_execute_feeRoundsToZeroOnTinyAmount() public {
        vm.prank(owner);
        sip.setFee(100); // 1%
        // 9 * 100 / 10_000 = 0 in integer division
        _prepareSwap(1);
        _execute(9, _params(1));
        assertEq(spendToken.balanceOf(treasury), 0);
    }

    // ── execute() — swap mechanics ────────────────────────────────────────────

    function test_execute_aggregatorApprovalSetToSwapAmount() public {
        // fee == 0, so swapAmount == AMOUNT
        aggregator.setCaptureAllowance(address(spendToken), address(sip));
        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(aggregator.capturedAllowance(), AMOUNT);
    }

    function test_execute_aggregatorApprovalResetToZeroAfterSwap() public {
        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(spendToken.allowance(address(sip), address(aggregator)), 0);
    }

    function test_execute_revertsOnSwapFailure() public {
        aggregator.setShouldFail(true);
        spendToken.mint(address(sip), AMOUNT);
        vm.prank(subscriptions);
        vm.expectRevert(SIPService.SwapFailed.selector);
        sip.execute(subscriber, address(spendToken), AMOUNT, _params(1));
    }

    function test_execute_surplusFullyForwardedToSubscriber() public {
        uint256 bigOut = OUT_AMT + 100e6; // aggregator delivers more than minOut
        _fullExec(AMOUNT, bigOut, 1);
        assertEq(outToken.balanceOf(subscriber), bigOut);
    }

    // ── execute() — slippage ──────────────────────────────────────────────────

    function test_execute_revertsSlippageExceeded() public {
        uint256 delivered = 500e6;
        uint256 minOut    = 600e6;
        _prepareSwap(delivered);
        spendToken.mint(address(sip), AMOUNT);
        vm.prank(subscriptions);
        vm.expectRevert(abi.encodeWithSelector(SIPService.SlippageExceeded.selector, delivered, minOut));
        sip.execute(subscriber, address(spendToken), AMOUNT, _params(minOut));
    }

    function test_execute_succeedsAtExactMinOutputAmount() public {
        uint256 exact = 800e6;
        _fullExec(AMOUNT, exact, exact); // delivered == minOut
        assertEq(outToken.balanceOf(subscriber), exact);
    }

    function test_execute_succeedsAboveMinOutputAmount() public {
        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(outToken.balanceOf(subscriber), OUT_AMT);
    }

    // ── execute() — output & events ───────────────────────────────────────────

    function test_execute_subscriberReceivesOutputTokens() public {
        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(outToken.balanceOf(subscriber), OUT_AMT);
    }

    function test_execute_noOutputTokensLeftInContract() public {
        _fullExec(AMOUNT, OUT_AMT, 1);
        assertEq(outToken.balanceOf(address(sip)), 0);
    }

    function test_execute_emitsSwapExecuted() public {
        _prepareSwap(OUT_AMT);
        // Mint before expectEmit — the next external call after expectEmit must be sip.execute
        spendToken.mint(address(sip), AMOUNT);
        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(subscriber, address(spendToken), address(outToken), AMOUNT, OUT_AMT, 0);
        vm.prank(subscriptions);
        sip.execute(subscriber, address(spendToken), AMOUNT, _params(1));
    }

    function test_execute_emitsSwapExecutedWithCappedFeeAmount() public {
        vm.startPrank(owner);
        sip.setFee(200);
        sip.setMaxFeeAmount(5e6);
        vm.stopPrank();

        _prepareSwap(OUT_AMT);
        spendToken.mint(address(sip), AMOUNT);
        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(subscriber, address(spendToken), address(outToken), AMOUNT, OUT_AMT, 5e6);
        vm.prank(subscriptions);
        sip.execute(subscriber, address(spendToken), AMOUNT, _params(1));
    }

    function test_execute_returnsTrue() public {
        assertTrue(_fullExec(AMOUNT, OUT_AMT, 1));
    }

    // ── Reentrancy ────────────────────────────────────────────────────────────

    // ReentrantAggregator is deployed as BOTH the subscriptions address and the aggregator.
    // When execute() calls aggregator.swap(), the aggregator re-enters execute().
    // onlySubscriptions passes (caller == subscriptions address), but nonReentrant blocks it.
    // The inner revert bubbles through the low-level call → execute() reverts SwapFailed.
    function test_execute_blocksReentrantAggregator() public {
        ReentrantAggregator reentrant = new ReentrantAggregator();

        vm.prank(owner);
        SIPService sipX = new SIPService(address(reentrant), treasury, MAX_FEE, address(reentrant));
        vm.prank(owner);
        sipX.addToken(address(outToken));

        reentrant.setSip(address(sipX));
        reentrant.setSubscriber(subscriber);
        reentrant.setSpendToken(address(spendToken));
        reentrant.setAmount(AMOUNT);

        bytes memory p = abi.encode(SwapParams({
            outputToken:     address(outToken),
            minOutputAmount: 1,
            swapData:        abi.encodeWithSelector(ReentrantAggregator.swap.selector)
        }));
        reentrant.setParams(p);

        spendToken.mint(address(sipX), AMOUNT);

        vm.prank(address(reentrant)); // reentrant IS subscriptions
        vm.expectRevert(SIPService.SwapFailed.selector);
        sipX.execute(subscriber, address(spendToken), AMOUNT, p);
    }
}
