// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IQorePQC {
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);
}

/// @notice Holds native funds and pays one fixed recipient under an immutable policy.
contract DianaPaymentAccount {
    error InvalidConfiguration();
    error Unauthorized();
    error WrongRecipient();
    error OutsidePaymentWindow();
    error InvalidNonce();
    error InvalidAmount();
    error BudgetExceeded();
    error PaymentCountExceeded();
    error InsufficientBalance();
    error ReentrantPayment();
    error PaymentFailed();
    error WrongChain();
    error InvalidInvoice();
    error InvoiceAlreadyPaid();
    error InvalidSignature();
    error PqcKeyUnavailable();

    event PaymentExecuted(uint256 indexed nonce, address indexed recipient, bytes32 indexed invoiceId, uint256 amount);

    uint256 private constant DIANA_CHAIN_ID = 9800;
    address private constant PQC_VERIFY = address(0x0a01);
    address private constant PQC_KEY_STATUS = address(0x0a02);
    uint256 private constant PUBLIC_KEY_BYTES = 2592;
    uint256 private constant SIGNATURE_BYTES = 4627;
    bytes32 private constant INVOICE_TYPEHASH = keccak256(
        "DianaInvoiceV1(uint256 chainId,address account,address issuer,address recipient,uint256 amount,bytes32 invoiceId,uint256 nonce,uint256 validUntil)"
    );

    address public immutable executor;
    address payable public immutable recipient;
    address public immutable invoiceIssuer;
    uint256 public immutable maxPerPayment;
    uint256 public immutable spendingLimit;
    uint256 public immutable maxPayments;
    uint256 public immutable startsAt;
    uint256 public immutable endsAt;

    uint256 public totalSpent;
    /// @notice The next command nonce, also the count of successful payments.
    uint256 public nextNonce;
    mapping(bytes32 => bool) public paidInvoices;
    bool private paying;

    constructor(
        address executor_,
        address payable recipient_,
        uint256 maxPerPayment_,
        uint256 spendingLimit_,
        uint256 maxPayments_,
        uint256 startsAt_,
        uint256 endsAt_,
        address invoiceIssuer_
    ) {
        if (
            executor_ == address(0) || recipient_ == address(0) || recipient_ == address(this)
                || maxPerPayment_ == 0 || maxPerPayment_ > spendingLimit_ || maxPayments_ == 0
                || startsAt_ >= endsAt_ || invoiceIssuer_ == address(0)
        ) revert InvalidConfiguration();

        executor = executor_;
        recipient = recipient_;
        invoiceIssuer = invoiceIssuer_;
        maxPerPayment = maxPerPayment_;
        spendingLimit = spendingLimit_;
        maxPayments = maxPayments_;
        startsAt = startsAt_;
        endsAt = endsAt_;
    }

    receive() external payable {}

    /// @notice Return the exact 32 bytes the issuer signs with ML-DSA-87.
    function invoiceDigest(address target, uint256 amount, bytes32 invoiceId, uint256 nonce, uint256 validUntil)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(INVOICE_TYPEHASH, block.chainid, address(this), invoiceIssuer, target, amount, invoiceId, nonce, validUntil)
        );
    }

    /// @notice Pay an unused, signed Diana invoice through the authorized executor.
    function pay(
        address payable target,
        uint256 amount,
        uint256 nonce,
        bytes32 invoiceId,
        uint256 validUntil,
        bytes calldata signature
    ) external {
        if (msg.sender != executor) revert Unauthorized();
        if (paying) revert ReentrantPayment();
        if (block.chainid != DIANA_CHAIN_ID) revert WrongChain();
        if (target != recipient) revert WrongRecipient();
        if (block.timestamp < startsAt || block.timestamp >= endsAt) revert OutsidePaymentWindow();
        if (invoiceId == bytes32(0) || block.timestamp >= validUntil) revert InvalidInvoice();
        if (nonce != nextNonce) revert InvalidNonce();
        if (paidInvoices[invoiceId]) revert InvoiceAlreadyPaid();
        if (amount == 0 || amount > maxPerPayment) revert InvalidAmount();
        if (amount > spendingLimit - totalSpent) revert BudgetExceeded();
        if (nonce >= maxPayments) revert PaymentCountExceeded();
        if (amount > address(this).balance) revert InsufficientBalance();

        _verifyInvoice(invoiceDigest(target, amount, invoiceId, nonce, validUntil), signature);

        paying = true;
        paidInvoices[invoiceId] = true;
        totalSpent += amount;
        nextNonce = nonce + 1;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert PaymentFailed();
        paying = false;

        emit PaymentExecuted(nonce, recipient, invoiceId, amount);
    }

    function _verifyInvoice(bytes32 digest, bytes calldata signature) private view {
        if (signature.length != SIGNATURE_BYTES) revert InvalidSignature();

        (bool keyOk, bytes memory keyResult) =
            PQC_KEY_STATUS.staticcall(abi.encodeCall(IQorePQC.pqcKeyStatus, (invoiceIssuer)));
        // Four ABI head words, a length word, and the word-aligned public key.
        if (!keyOk || keyResult.length != 5 * 32 + PUBLIC_KEY_BYTES) revert PqcKeyUnavailable();
        (bool registered, uint8 algorithmId, bytes memory publicKey, bool possessionProven) =
            abi.decode(keyResult, (bool, uint8, bytes, bool));
        if (!registered || algorithmId != 1 || !possessionProven || publicKey.length != PUBLIC_KEY_BYTES) {
            revert PqcKeyUnavailable();
        }

        (bool verifyOk, bytes memory verifyResult) =
            PQC_VERIFY.staticcall(abi.encodeCall(IQorePQC.pqcVerify, (publicKey, signature, abi.encodePacked(digest))));
        if (!verifyOk || verifyResult.length != 32 || !abi.decode(verifyResult, (bool))) {
            revert InvalidSignature();
        }
    }
}
