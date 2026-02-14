// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITIP20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract AgentGuardVault {
    struct PaymentIntent {
        bytes32 intentId;
        address to;
        address token;
        uint256 amount;
        bytes32 memo;
        uint256 nonce;
        uint256 deadline;
    }

    address public owner;
    bytes32 public ownerRef;
    uint256 public maxAmountPerPayment;
    bool public paused;
    bool public recipientAllowlistEnforced;

    mapping(uint256 => bool) public usedNonces;
    mapping(address => bool) public allowedToken;
    mapping(address => bool) public allowedRecipient;

    uint256 private reentrancyState = 1;

    event PaymentExecuted(
        bytes32 indexed intentId,
        address indexed to,
        address indexed token,
        uint256 amount,
        bytes32 memo,
        uint256 nonce
    );
    event PolicyUpdated(bytes32 indexed key, bytes value);
    event OwnerRefUpdated(bytes32 indexed ownerRefValue);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "PAUSED");
        _;
    }

    modifier nonReentrant() {
        require(reentrancyState == 1, "REENTRANCY");
        reentrancyState = 2;
        _;
        reentrancyState = 1;
    }

    constructor(bytes32 ownerRefValue, uint256 maxAmountValue) {
        owner = msg.sender;
        ownerRef = ownerRefValue;
        maxAmountPerPayment = maxAmountValue;
    }

    function executeAuthorizedPayment(
        PaymentIntent calldata intent,
        bytes calldata ownerAuth
    ) external whenNotPaused nonReentrant {
        require(block.timestamp <= intent.deadline, "INTENT_EXPIRED");
        require(!usedNonces[intent.nonce], "NONCE_ALREADY_USED");
        require(intent.amount <= maxAmountPerPayment, "AMOUNT_EXCEEDS_LIMIT");
        require(allowedToken[intent.token], "TOKEN_NOT_ALLOWED");

        if (recipientAllowlistEnforced) {
            require(allowedRecipient[intent.to], "RECIPIENT_NOT_ALLOWED");
        }

        bytes32 digest = _intentDigest(intent);
        require(
            _validateTempoOwnerAuth(ownerRef, digest, ownerAuth),
            "INVALID_OWNER_AUTH"
        );

        usedNonces[intent.nonce] = true;

        bool transferOk = ITIP20(intent.token).transfer(intent.to, intent.amount);
        require(transferOk, "TOKEN_TRANSFER_FAILED");

        emit PaymentExecuted(
            intent.intentId,
            intent.to,
            intent.token,
            intent.amount,
            intent.memo,
            intent.nonce
        );
    }

    function setOwnerRef(bytes32 ownerRefValue) external onlyOwner {
        ownerRef = ownerRefValue;
        emit OwnerRefUpdated(ownerRefValue);
    }

    function setMaxAmountPerPayment(uint256 amount) external onlyOwner {
        maxAmountPerPayment = amount;
        emit PolicyUpdated("maxAmountPerPayment", abi.encode(amount));
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        allowedToken[token] = allowed;
        emit PolicyUpdated("allowedToken", abi.encode(token, allowed));
    }

    function setRecipientAllowed(address recipient, bool allowed) external onlyOwner {
        allowedRecipient[recipient] = allowed;
        emit PolicyUpdated("allowedRecipient", abi.encode(recipient, allowed));
    }

    function setRecipientAllowlistEnforced(bool enabled) external onlyOwner {
        recipientAllowlistEnforced = enabled;
        emit PolicyUpdated("recipientAllowlistEnforced", abi.encode(enabled));
    }

    function pause() external onlyOwner {
        paused = true;
        emit PolicyUpdated("paused", abi.encode(true));
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PolicyUpdated("paused", abi.encode(false));
    }

    function _intentDigest(PaymentIntent calldata intent) internal view returns (bytes32) {
        bytes32 typeHash =
            keccak256(
                "PaymentIntent(bytes32 intentId,address to,address token,uint256 amount,bytes32 memo,uint256 nonce,uint256 deadline,uint256 chainId,address verifyingContract)"
            );

        return
            keccak256(
                abi.encode(
                    typeHash,
                    intent.intentId,
                    intent.to,
                    intent.token,
                    intent.amount,
                    intent.memo,
                    intent.nonce,
                    intent.deadline,
                    block.chainid,
                    address(this)
                )
            );
    }

    function _validateTempoOwnerAuth(
        bytes32 expectedOwnerRef,
        bytes32 digest,
        bytes calldata ownerAuth
    ) internal pure returns (bool) {
        // Hackathon placeholder:
        // ownerAuth is expected to be abi.encode(address signer, bytes signature).
        // Replace with Tempo-native passkey/account authorization decoding when integrating chain SDK.
        (address signer, bytes memory signature) = abi.decode(ownerAuth, (address, bytes));
        if (keccak256(abi.encodePacked(signer)) != expectedOwnerRef) {
            return false;
        }
        return _recoverSigner(digest, signature) == signer;
    }

    function _recoverSigner(bytes32 digest, bytes memory signature)
        internal
        pure
        returns (address)
    {
        if (signature.length != 65) {
            return address(0);
        }

        bytes32 r;
        bytes32 s;
        uint8 v;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) {
            v += 27;
        }

        if (v != 27 && v != 28) {
            return address(0);
        }

        return ecrecover(digest, v, r, s);
    }
}
