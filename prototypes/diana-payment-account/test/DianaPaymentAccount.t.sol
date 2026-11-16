// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DianaPaymentAccount, IQorePQC} from "../src/DianaPaymentAccount.sol";

interface Vm {
    function deal(address account, uint256 balance) external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 chainId_) external;
    function mockCall(address callee, bytes calldata data, bytes calldata result) external;
    function mockCallRevert(address callee, bytes calldata data, bytes calldata result) external;
    function clearMockedCalls() external;
}

contract RejectingRecipient {
    bool private rejects = true;

    function acceptPayments() external {
        rejects = false;
    }

    receive() external payable {
        require(!rejects);
    }
}

contract ReenteringRecipient {
    DianaPaymentAccount private account;
    bool public reentryRejected;

    function attemptPayment(DianaPaymentAccount target) external {
        account = target;
        target.pay(payable(address(this)), 1 ether, 0, bytes32(uint256(1)), 2_000, new bytes(4627));
    }

    receive() external payable {
        try account.pay(payable(address(this)), 1 ether, 1, bytes32(uint256(2)), 2_000, new bytes(4627)) {
            revert("reentry succeeded");
        } catch (bytes memory errorData) {
            require(bytes4(errorData) == DianaPaymentAccount.ReentrantPayment.selector);
            reentryRejected = true;
        }
    }
}

contract DianaPaymentAccountTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant EXECUTOR = address(0xE1A);
    address private constant ISSUER = address(0xE1B);
    address private constant KEY_STATUS = address(0x0a02);
    address private constant VERIFY = address(0x0a01);
    address payable private constant RECIPIENT = payable(address(0xBEEF));
    uint256 private constant START = 1_000;
    uint256 private constant END = 2_000;
    DianaPaymentAccount private account;

    function setUp() public {
        vm.chainId(9800);
        vm.warp(START);
        _mockKey(true, 1, true);
        account = _funded(EXECUTOR, RECIPIENT, 2 ether, 3 ether, 3);
    }

    function testAuthorizedPaymentAtStart() public {
        uint256 beforeBalance = RECIPIENT.balance;
        _pay(account, RECIPIENT, 2 ether, 0);
        require(RECIPIENT.balance == beforeBalance + 2 ether);
        _assertState(account, 2 ether, 1, 8 ether);
    }

    function testWrongRecipient() public {
        _expectRejected(account, payable(address(0xCAFE)), 1 ether, 0, DianaPaymentAccount.WrongRecipient.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testPerPaymentLimit() public {
        _expectRejected(account, RECIPIENT, 2 ether + 1, 0, DianaPaymentAccount.InvalidAmount.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testTotalBudgetLimit() public {
        _pay(account, RECIPIENT, 2 ether, 0);
        _expectRejected(account, RECIPIENT, 1 ether + 1, 1, DianaPaymentAccount.BudgetExceeded.selector);
        _assertState(account, 2 ether, 1, 8 ether);
        _pay(account, RECIPIENT, 1 ether, 1);
        _assertState(account, 3 ether, 2, 7 ether);
    }

    function testPaymentCountLimit() public {
        DianaPaymentAccount single = _funded(EXECUTOR, RECIPIENT, 2 ether, 3 ether, 1);
        _pay(single, RECIPIENT, 1 ether, 0);
        _expectRejected(single, RECIPIENT, 1 ether, 1, DianaPaymentAccount.PaymentCountExceeded.selector);
        _assertState(single, 1 ether, 1, 9 ether);
    }

    function testBeforeStart() public {
        vm.warp(START - 1);
        _expectRejected(account, RECIPIENT, 1 ether, 0, DianaPaymentAccount.OutsidePaymentWindow.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testImmediatelyBeforeEnd() public {
        vm.warp(END - 1);
        _pay(account, RECIPIENT, 1 ether, 0);
        _assertState(account, 1 ether, 1, 9 ether);
    }

    function testAtEnd() public {
        vm.warp(END);
        _expectRejected(account, RECIPIENT, 1 ether, 0, DianaPaymentAccount.OutsidePaymentWindow.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testUnauthorizedSender() public {
        vm.expectRevert(DianaPaymentAccount.Unauthorized.selector);
        account.pay(RECIPIENT, 1 ether, 0, bytes32(uint256(1)), END, new bytes(4627));
        _assertState(account, 0, 0, 10 ether);
    }

    function testReplayAndFutureNonce() public {
        _pay(account, RECIPIENT, 1 ether, 0);
        _expectRejected(account, RECIPIENT, 1 ether, 0, DianaPaymentAccount.InvalidNonce.selector);
        _expectRejected(account, RECIPIENT, 1 ether, 2, DianaPaymentAccount.InvalidNonce.selector);
        _assertState(account, 1 ether, 1, 9 ether);
    }

    function testRecipientRevertRollsBackAndCanRetrySameNonce() public {
        RejectingRecipient receiver = new RejectingRecipient();
        address payable recipient = payable(address(receiver));
        DianaPaymentAccount rejecting = _funded(EXECUTOR, recipient, 2 ether, 3 ether, 2);
        _mockSignature(rejecting, recipient, 1 ether, bytes32(uint256(1)), 0, END, true);
        _expectRejected(rejecting, recipient, 1 ether, 0, DianaPaymentAccount.PaymentFailed.selector);
        _assertState(rejecting, 0, 0, 10 ether);
        require(!rejecting.paidInvoices(bytes32(uint256(1))));
        require(recipient.balance == 0);
        receiver.acceptPayments();
        _pay(rejecting, recipient, 1 ether, 0);
        _assertState(rejecting, 1 ether, 1, 9 ether);
        require(rejecting.paidInvoices(bytes32(uint256(1))));
        require(recipient.balance == 1 ether);
    }

    function testInsufficientBalanceLeavesLimitsIntact() public {
        vm.deal(address(account), 0);
        _expectRejected(account, RECIPIENT, 1 ether, 0, DianaPaymentAccount.InsufficientBalance.selector);
        _assertState(account, 0, 0, 0);
    }

    function testAuthorizedRecipientCannotReenterWithNextNonce() public {
        ReenteringRecipient receiver = new ReenteringRecipient();
        address payable recipient = payable(address(receiver));
        DianaPaymentAccount reentrant = _funded(recipient, recipient, 2 ether, 3 ether, 2);
        _mockSignature(reentrant, recipient, 1 ether, bytes32(uint256(1)), 0, END, true);
        receiver.attemptPayment(reentrant);
        require(receiver.reentryRejected());
        require(recipient.balance == 1 ether);
        _assertState(reentrant, 1 ether, 1, 9 ether);
    }

    function testZeroAmount() public {
        _expectRejected(account, RECIPIENT, 0, 0, DianaPaymentAccount.InvalidAmount.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testInvalidConfigurations() public {
        vm.expectRevert(DianaPaymentAccount.InvalidConfiguration.selector);
        new DianaPaymentAccount(address(0), RECIPIENT, 1, 1, 1, START, END, ISSUER);
        vm.expectRevert(DianaPaymentAccount.InvalidConfiguration.selector);
        new DianaPaymentAccount(EXECUTOR, payable(address(0)), 1, 1, 1, START, END, ISSUER);
        vm.expectRevert(DianaPaymentAccount.InvalidConfiguration.selector);
        new DianaPaymentAccount(EXECUTOR, RECIPIENT, 2, 1, 1, START, END, ISSUER);
        vm.expectRevert(DianaPaymentAccount.InvalidConfiguration.selector);
        new DianaPaymentAccount(EXECUTOR, RECIPIENT, 0, 1, 1, START, END, ISSUER);
        vm.expectRevert(DianaPaymentAccount.InvalidConfiguration.selector);
        new DianaPaymentAccount(EXECUTOR, RECIPIENT, 1, 1, 0, START, END, ISSUER);
        vm.expectRevert(DianaPaymentAccount.InvalidConfiguration.selector);
        new DianaPaymentAccount(EXECUTOR, RECIPIENT, 1, 1, 1, END, END, ISSUER);
        vm.expectRevert(DianaPaymentAccount.InvalidConfiguration.selector);
        new DianaPaymentAccount(EXECUTOR, RECIPIENT, 1, 1, 1, START, END, address(0));
    }

    function testInvoiceDigestMatchesCanonicalDianaDomain() public view {
        bytes32 typeHash = keccak256(
            "DianaInvoiceV1(uint256 chainId,address account,address issuer,address recipient,uint256 amount,bytes32 invoiceId,uint256 nonce,uint256 validUntil)"
        );
        bytes32 expected = keccak256(
            abi.encode(typeHash, uint256(9800), address(account), ISSUER, RECIPIENT, 1 ether, bytes32(uint256(1)), uint256(0), END)
        );
        require(account.invoiceDigest(RECIPIENT, 1 ether, bytes32(uint256(1)), 0, END) == expected);
    }

    function testValidInvoiceUsesBothPrecompileInterfaces() public {
        _pay(account, RECIPIENT, 1 ether, 0);
        _assertState(account, 1 ether, 1, 9 ether);
        require(account.paidInvoices(bytes32(uint256(1))));
    }

    function testInvalidSignature() public {
        _mockSignature(account, RECIPIENT, 1 ether, bytes32(uint256(1)), 0, END, false);
        _expectInvoiceRejected(account, 1 ether, bytes32(uint256(1)), 0, END, DianaPaymentAccount.InvalidSignature.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testWrongSignatureLength() public {
        vm.expectRevert(DianaPaymentAccount.InvalidSignature.selector);
        vm.prank(EXECUTOR);
        account.pay(RECIPIENT, 1 ether, 0, bytes32(uint256(1)), END, new bytes(4626));
        _assertState(account, 0, 0, 10 ether);
    }

    function testUnsignedLegacySelectorCannotPay() public {
        vm.prank(EXECUTOR);
        (bool success,) = address(account).call(abi.encodeWithSignature("pay(address,uint256,uint256)", RECIPIENT, 1 ether, 0));
        require(!success);
        _assertState(account, 0, 0, 10 ether);
    }

    function testWrongChain() public {
        bytes32 id = bytes32(uint256(1));
        bytes32 dianaDigest = account.invoiceDigest(RECIPIENT, 1 ether, id, 0, END);
        _mockSignature(account, RECIPIENT, 1 ether, id, 0, END, true);
        vm.chainId(9801);
        require(account.invoiceDigest(RECIPIENT, 1 ether, id, 0, END) != dianaDigest);
        _expectInvoiceRejected(account, 1 ether, id, 0, END, DianaPaymentAccount.WrongChain.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testSignatureForAnotherContractIsRejected() public {
        bytes32 id = bytes32(uint256(1));
        _mockSignature(account, RECIPIENT, 1 ether, id, 0, END, true);
        DianaPaymentAccount other = _funded(EXECUTOR, RECIPIENT, 2 ether, 3 ether, 3);
        _expectInvoiceRejected(other, 1 ether, id, 0, END, DianaPaymentAccount.InvalidSignature.selector);
        _assertState(other, 0, 0, 10 ether);
    }

    function testSignedAmountAndInvoiceIdCannotBeChanged() public {
        bytes32 id = bytes32(uint256(1));
        _mockSignature(account, RECIPIENT, 1 ether, id, 0, END, true);
        _expectInvoiceRejected(account, 1 ether + 1, id, 0, END, DianaPaymentAccount.InvalidSignature.selector);
        _expectInvoiceRejected(account, 1 ether, bytes32(uint256(2)), 0, END, DianaPaymentAccount.InvalidSignature.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testSignedRecipientCannotBeChanged() public {
        bytes32 id = bytes32(uint256(1));
        _mockSignature(account, address(0xCAFE), 1 ether, id, 0, END, true);
        _expectInvoiceRejected(account, 1 ether, id, 0, END, DianaPaymentAccount.InvalidSignature.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testExpiredInvoiceAndExpiryTampering() public {
        bytes32 id = bytes32(uint256(1));
        _mockSignature(account, RECIPIENT, 1 ether, id, 0, START, true);
        _expectInvoiceRejected(account, 1 ether, id, 0, START, DianaPaymentAccount.InvalidInvoice.selector);
        _expectInvoiceRejected(account, 1 ether, id, 0, END, DianaPaymentAccount.InvalidSignature.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testPaidInvoiceCannotBeReissuedWithFreshNonce() public {
        bytes32 id = bytes32(uint256(1));
        _pay(account, RECIPIENT, 1 ether, 0);
        _mockSignature(account, RECIPIENT, 1 ether, id, 1, END, true);
        _expectInvoiceRejected(account, 1 ether, id, 1, END, DianaPaymentAccount.InvoiceAlreadyPaid.selector);
        _assertState(account, 1 ether, 1, 9 ether);
    }

    function testMissingKeyPrecompileFailsClosed() public {
        vm.clearMockedCalls();
        _expectInvoiceRejected(account, 1 ether, bytes32(uint256(1)), 0, END, DianaPaymentAccount.PqcKeyUnavailable.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testKeyMustHaveRegistrationAlgorithmAndPossessionProof() public {
        bytes32 id = bytes32(uint256(1));
        _mockSignature(account, RECIPIENT, 1 ether, id, 0, END, true);
        _mockKey(false, 1, true);
        _expectInvoiceRejected(account, 1 ether, id, 0, END, DianaPaymentAccount.PqcKeyUnavailable.selector);
        _mockKey(true, 2, true);
        _expectInvoiceRejected(account, 1 ether, id, 0, END, DianaPaymentAccount.PqcKeyUnavailable.selector);
        _mockKey(true, 1, false);
        _expectInvoiceRejected(account, 1 ether, id, 0, END, DianaPaymentAccount.PqcKeyUnavailable.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function testVerifierRevertAndTruncatedReturnFailClosed() public {
        bytes32 id = bytes32(uint256(1));
        bytes memory input = _verifyInput(account, RECIPIENT, 1 ether, id, 0, END);
        vm.mockCall(VERIFY, input, hex"01");
        _expectInvoiceRejected(account, 1 ether, id, 0, END, DianaPaymentAccount.InvalidSignature.selector);
        vm.clearMockedCalls();
        _mockKey(true, 1, true);
        vm.mockCallRevert(VERIFY, input, hex"");
        _expectInvoiceRejected(account, 1 ether, id, 0, END, DianaPaymentAccount.InvalidSignature.selector);
        _assertState(account, 0, 0, 10 ether);
    }

    function _funded(address executor, address payable recipient, uint256 perPayment, uint256 budget, uint256 count)
        private
        returns (DianaPaymentAccount funded)
    {
        funded = new DianaPaymentAccount(executor, recipient, perPayment, budget, count, START, END, ISSUER);
        vm.deal(address(funded), 10 ether);
    }

    function _pay(DianaPaymentAccount target, address payable recipient, uint256 amount, uint256 nonce) private {
        bytes32 id = bytes32(nonce + 1);
        _mockSignature(target, recipient, amount, id, nonce, END, true);
        vm.prank(EXECUTOR);
        target.pay(recipient, amount, nonce, id, END, new bytes(4627));
    }

    function _expectRejected(
        DianaPaymentAccount target, address payable recipient, uint256 amount, uint256 nonce, bytes4 selector
    ) private {
        vm.expectRevert(selector);
        vm.prank(EXECUTOR);
        target.pay(recipient, amount, nonce, bytes32(nonce + 1), END, new bytes(4627));
    }

    function _expectInvoiceRejected(
        DianaPaymentAccount target, uint256 amount, bytes32 id, uint256 nonce, uint256 validUntil, bytes4 selector
    ) private {
        vm.expectRevert(selector);
        vm.prank(EXECUTOR);
        target.pay(RECIPIENT, amount, nonce, id, validUntil, new bytes(4627));
    }

    // Exact calldata test doubles. Neither zero-filled byte array is a cryptographic vector.
    function _mockKey(bool registered, uint8 algorithmId, bool possessionProven) private {
        vm.mockCall(
            KEY_STATUS, abi.encodeCall(IQorePQC.pqcKeyStatus, (ISSUER)),
            abi.encode(registered, algorithmId, new bytes(2592), possessionProven)
        );
    }

    function _mockSignature(
        DianaPaymentAccount target, address recipient, uint256 amount, bytes32 id, uint256 nonce, uint256 validUntil, bool valid
    ) private {
        vm.mockCall(VERIFY, _verifyInput(target, recipient, amount, id, nonce, validUntil), abi.encode(valid));
    }

    function _verifyInput(
        DianaPaymentAccount target, address recipient, uint256 amount, bytes32 id, uint256 nonce, uint256 validUntil
    ) private view returns (bytes memory) {
        return abi.encodeCall(
            IQorePQC.pqcVerify,
            (new bytes(2592), new bytes(4627), abi.encodePacked(target.invoiceDigest(recipient, amount, id, nonce, validUntil)))
        );
    }

    function _assertState(DianaPaymentAccount target, uint256 spent, uint256 nonce, uint256 balance) private view {
        require(target.totalSpent() == spent, "incorrect spend");
        require(target.nextNonce() == nonce, "incorrect nonce or count");
        require(address(target).balance == balance, "incorrect balance");
    }
}
