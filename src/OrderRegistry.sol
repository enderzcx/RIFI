// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

/// @title OrderRegistry — On-chain order book for stop-loss / take-profit
/// @notice Deployed on Base (8453). PairOrderManager on Reactive Network subscribes to events.
contract OrderRegistry {

    struct Order {
        address reactiveContract;
        address pair;
        address client;
        bool    isStopLoss;
        bool    sellToken0;
        uint256 coefficient;
        uint256 threshold;
        uint256 amount;
        uint256 linkedOrderId;
        bool    active;
    }

    mapping(uint256 => Order) public orders;
    uint256 public nextOrderId = 1;
    address public backend;
    address public callbackAddr;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed pair,
        address indexed client,
        bool    isStopLoss,
        bool    sellToken0,
        uint256 coefficient,
        uint256 threshold,
        uint256 amount,
        uint256 linkedOrderId
    );

    event OrderCancelled(uint256 indexed orderId, address indexed client);
    event OrderReset(uint256 indexed orderId);
    event OrderExecuted(uint256 indexed orderId);

    modifier onlyBackend() {
        require(msg.sender == backend, "Only backend");
        _;
    }

    modifier onlyCallback() {
        require(msg.sender == callbackAddr, "Only callback");
        _;
    }

    constructor(address _backend, address _callbackAddr) {
        backend      = _backend;
        callbackAddr = _callbackAddr;
    }

    function createOrder(
        address pair,
        bool    isStopLoss,
        bool    sellToken0,
        uint256 coefficient,
        uint256 threshold,
        uint256 amount,
        uint256 linkedOrderId
    ) external returns (uint256 orderId) {
        orderId = nextOrderId++;
        orders[orderId] = Order({
            reactiveContract: address(0),
            pair:             pair,
            client:           msg.sender,
            isStopLoss:       isStopLoss,
            sellToken0:       sellToken0,
            coefficient:      coefficient,
            threshold:        threshold,
            amount:           amount,
            linkedOrderId:    linkedOrderId,
            active:           true
        });

        emit OrderCreated(
            orderId, pair, msg.sender,
            isStopLoss, sellToken0, coefficient,
            threshold, amount, linkedOrderId
        );
    }

    function cancelOrder(uint256 orderId) external {
        Order storage o = orders[orderId];
        require(o.client == msg.sender, "Not owner");
        require(o.active, "Already inactive");

        o.active = false;
        emit OrderCancelled(orderId, msg.sender);
        _cancelLinked(orderId);
    }

    function setReactiveContract(uint256 orderId, address reactiveAddr) external onlyBackend {
        orders[orderId].reactiveContract = reactiveAddr;
    }

    function setLinkedOrder(uint256 orderId, uint256 linkedId) external onlyBackend {
        require(orders[orderId].client != address(0), "Order not found");
        orders[orderId].linkedOrderId = linkedId;
    }

    function setCallbackAddr(address _callbackAddr) external onlyBackend {
        callbackAddr = _callbackAddr;
    }

    function resetOrder(uint256 orderId) external onlyBackend {
        orders[orderId].active = true;
        emit OrderReset(orderId);
    }

    function markExecutedAndCancelLinked(uint256 orderId) external onlyCallback {
        orders[orderId].active = false;
        emit OrderExecuted(orderId);
        _cancelLinked(orderId);
    }

    function verifyOrder(
        uint256 orderId,
        address pair,
        address client,
        uint256 amount
    ) external view returns (bool) {
        Order storage o = orders[orderId];
        return o.active
            && o.pair   == pair
            && o.client == client
            && o.amount == amount;
    }

    function _cancelLinked(uint256 orderId) internal {
        uint256 linkedId = orders[orderId].linkedOrderId;
        if (linkedId != 0 && orders[linkedId].active) {
            orders[linkedId].active = false;
            emit OrderCancelled(linkedId, orders[linkedId].client);
        }
    }
}
