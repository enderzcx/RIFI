// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import "reactive-lib/interfaces/IReactive.sol";
import "reactive-lib/abstract-base/AbstractReactive.sol";

interface IStopOrderCallback {
    function execute(
        address rvmId,
        address pair,
        address client,
        bool    sellToken0,
        bool    isStopLoss,
        uint256 amount,
        uint256 coefficient,
        uint256 threshold,
        uint256 orderId
    ) external;
}

/// @title PairOrderManager — Reactive contract monitoring Base (8453)
/// @notice Deployed on Reactive Network. Subscribes to Uniswap V2 Sync events
///         and OrderRegistry lifecycle events on Base.
contract PairOrderManager is IReactive, AbstractReactive {

    uint256 private constant BASE_CHAIN  = 8453;
    uint64  private constant GAS_LIMIT = 1_000_000;

    // Uniswap V2 Pair Sync(uint112 reserve0, uint112 reserve1)
    uint256 private constant SYNC_TOPIC =
        0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1;

    // OrderRegistry event topic hashes
    uint256 private constant ORDER_CREATED_TOPIC =
        0xe6ea6c0f2d4c92db08c5c0acb389adb6fcb85f21c7a2144b40609d011a0f9dbd;
    uint256 private constant CANCEL_TOPIC =
        0xc0362da6f2ff36b382b34aec0814f6b3cdf89f5ef282a1d1f114d0c0b036d596;
    uint256 private constant RESET_TOPIC =
        0xbef983cbc9aca317bd3be6e943aace9497a31b3a877fe1a8006b84c713ba8f4a;
    uint256 private constant EXECUTED_TOPIC =
        0xf03ed60bf824bdd2c1387f3534cb0fd2ab10270e8ce0cb8b2daec90068eb943e;

    struct OrderData {
        uint256 orderId;
        address client;
        bool    isStopLoss;
        bool    sellToken0;
        uint256 coefficient;
        uint256 threshold;
        uint256 amount;
        bool    active;
        bool    triggered;
    }

    address private immutable pair;
    address private immutable registryAddr;
    address private immutable callbackAddr;
    address private immutable backend;

    OrderData[] private orderList;
    mapping(uint256 => uint256) private orderIndex;

    event OrderAdded(uint256 indexed orderId);

    constructor(
        address _pair,
        address _registry,
        address _callbackAddr,
        address _backend,
        uint256[] memory _orderIds,
        address[] memory _clients,
        bool[]    memory _isStopLoss,
        bool[]    memory _sellToken0,
        uint256[] memory _coefficients,
        uint256[] memory _thresholds,
        uint256[] memory _amounts
    ) payable {
        pair         = _pair;
        registryAddr = _registry;
        callbackAddr = _callbackAddr;
        backend      = _backend;

        for (uint256 i = 0; i < _orderIds.length; i++) {
            _addOrder(
                _orderIds[i], _clients[i], _isStopLoss[i], _sellToken0[i],
                _coefficients[i], _thresholds[i], _amounts[i]
            );
        }

        if (!vm) {
            service.subscribe(
                BASE_CHAIN, _pair, SYNC_TOPIC,
                REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
            );
            service.subscribe(
                BASE_CHAIN, _registry, ORDER_CREATED_TOPIC,
                REACTIVE_IGNORE, uint256(uint160(_pair)), REACTIVE_IGNORE
            );
            service.subscribe(
                BASE_CHAIN, _registry, CANCEL_TOPIC,
                REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
            );
            service.subscribe(
                BASE_CHAIN, _registry, RESET_TOPIC,
                REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
            );
            service.subscribe(
                BASE_CHAIN, _registry, EXECUTED_TOPIC,
                REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
            );
        }
    }

    function addOrder(
        uint256 orderId,
        address client,
        bool    isStopLoss,
        bool    sellToken0,
        uint256 coefficient,
        uint256 threshold,
        uint256 amount
    ) external {
        require(msg.sender == backend, "Not backend");
        require(orderIndex[orderId] == 0, "Already exists");

        _addOrder(orderId, client, isStopLoss, sellToken0, coefficient, threshold, amount);
        emit OrderAdded(orderId);
    }

    function react(LogRecord calldata log) external vmOnly {

        if (log._contract == registryAddr && log.topic_0 == ORDER_CREATED_TOPIC) {
            (bool isStopLoss, bool sellToken0, uint256 coefficient, uint256 threshold, uint256 amount,) =
                abi.decode(log.data, (bool, bool, uint256, uint256, uint256, uint256));
            uint256 orderId = log.topic_1;
            address client  = address(uint160(log.topic_3));

            if (orderIndex[orderId] == 0) {
                _addOrder(orderId, client, isStopLoss, sellToken0, coefficient, threshold, amount);
            }
            return;
        }

        if (log._contract == registryAddr && (log.topic_0 == CANCEL_TOPIC || log.topic_0 == EXECUTED_TOPIC)) {
            _removeOrder(log.topic_1);
            return;
        }

        if (log._contract == registryAddr && log.topic_0 == RESET_TOPIC) {
            uint256 idx = orderIndex[log.topic_1];
            if (idx != 0) {
                orderList[idx - 1].triggered = false;
                orderList[idx - 1].active    = true;
            }
            return;
        }

        // SYNC: check price conditions
        (uint112 reserve0, uint112 reserve1) = abi.decode(log.data, (uint112, uint112));
        if (reserve0 == 0 || reserve1 == 0) return;

        uint256 length = orderList.length;
        for (uint256 i = 0; i < length; i++) {
            OrderData storage o = orderList[i];
            if (!o.active || o.triggered) continue;

            bool conditionMet;
            if (o.sellToken0) {
                uint256 val = uint256(reserve1) * o.coefficient / uint256(reserve0);
                conditionMet = o.isStopLoss ? (val <= o.threshold) : (val >= o.threshold);
            } else {
                uint256 val = uint256(reserve0) * o.coefficient / uint256(reserve1);
                conditionMet = o.isStopLoss ? (val <= o.threshold) : (val >= o.threshold);
            }

            if (conditionMet) {
                o.triggered = true;

                bytes memory payload = abi.encodeCall(
                    IStopOrderCallback.execute,
                    (
                        address(0),
                        pair,
                        o.client,
                        o.sellToken0,
                        o.isStopLoss,
                        o.amount,
                        o.coefficient,
                        o.threshold,
                        o.orderId
                    )
                );

                emit Callback(BASE_CHAIN, callbackAddr, GAS_LIMIT, payload);
            }
        }
    }

    function _addOrder(
        uint256 orderId, address client,
        bool isStopLoss, bool sellToken0,
        uint256 coefficient, uint256 threshold, uint256 amount
    ) internal {
        orderIndex[orderId] = orderList.length + 1;
        orderList.push(OrderData({
            orderId: orderId, client: client,
            isStopLoss: isStopLoss, sellToken0: sellToken0,
            coefficient: coefficient, threshold: threshold,
            amount: amount, active: true, triggered: false
        }));
    }

    function _removeOrder(uint256 orderId) internal {
        uint256 idxPlusOne = orderIndex[orderId];
        if (idxPlusOne == 0) return;

        uint256 idx     = idxPlusOne - 1;
        uint256 lastIdx = orderList.length - 1;

        if (idx != lastIdx) {
            OrderData memory moved = orderList[lastIdx];
            orderList[idx] = moved;
            orderIndex[moved.orderId] = idxPlusOne;
        }

        orderList.pop();
        delete orderIndex[orderId];
    }
}
