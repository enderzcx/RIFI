// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;

import "reactive-lib/interfaces/IReactive.sol";
import "reactive-lib/abstract-base/AbstractReactive.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title ArbitrumStopOrderReactive
 * @notice Reactive Smart Contract deployed on Reactive Mainnet (Chain ID 1597).
 *         Monitors SushiSwap V2 pair Sync events on Arbitrum (Chain ID 42161) and
 *         triggers executeStopOrder() on ArbitrumStopOrderCallback when a user's
 *         price threshold is crossed.
 *
 *         Supports unlimited concurrent orders — every order is independently tracked
 *         and triggered. Dynamic pair subscription ensures new pairs are automatically
 *         monitored when orders are created.
 *
 * Deployment:
 *   _admin            -> admin wallet
 *   _callbackContract -> ArbitrumStopOrderCallback address on Arbitrum
 *   _initialPair      -> SushiSwap V2 pair to pre-subscribe (e.g. WETH/USDC)
 */
contract ArbitrumStopOrderReactive is IReactive, AbstractReactive {

    // --- Chain IDs ---
    uint256 private constant ARBITRUM_CHAIN_ID  = 42161;
    uint256 private constant REACTIVE_CHAIN_ID  = 1597;

    // --- Event topic constants ---
    // Uniswap V2 / SushiSwap V2 Sync(uint112 reserve0, uint112 reserve1)
    uint256 private constant SYNC_TOPIC =
        0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1;

    // Callback lifecycle event topics (must match ArbitrumStopOrderCallback exactly)
    bytes32 private constant ORDER_CREATED_TOPIC = keccak256(
        "StopOrderCreated(address,uint256,address,bool,address,address,uint256,uint256,uint256,uint8)"
    );
    bytes32 private constant ORDER_CANCELLED_TOPIC = keccak256("StopOrderCancelled(uint256)");
    bytes32 private constant ORDER_EXECUTED_TOPIC = keccak256(
        "StopOrderExecuted(address,uint256,address,address,uint256,uint256)"
    );
    bytes32 private constant ORDER_PAUSED_TOPIC  = keccak256("StopOrderPaused(uint256)");
    bytes32 private constant ORDER_RESUMED_TOPIC = keccak256("StopOrderResumed(uint256)");

    // --- Gas & timing ---
    uint64  private constant CALLBACK_GAS_LIMIT  = 600_000;
    // Arbitrum produces blocks every ~0.25s; 60s cooldown between retries
    uint256 private constant TRIGGER_COOLDOWN    = 60;
    uint8   private constant MAX_TRIGGER_ATTEMPTS = 10;

    // --- Enums (must mirror ArbitrumStopOrderCallback) ---
    enum OrderType   { StopLoss, TakeProfit }
    enum OrderStatus { Active, Paused, Cancelled, Executed, Failed }

    // --- Structs ---
    struct Reserves {
        uint112 reserve0;
        uint112 reserve1;
    }

    struct TrackedOrder {
        uint256     id;
        address     pair;
        bool        sellToken0;
        uint256     coefficient;
        uint256     threshold;
        OrderType   orderType;
        OrderStatus status;
        uint256     lastTriggeredAt;
        uint8       triggerCount;
    }

    // --- Events ---
    event OrderTracked      (uint256 indexed orderId, address indexed pair, address indexed user);
    event OrderUntracked    (uint256 indexed orderId, OrderStatus reason);
    event ExecutionTriggered(uint256 indexed orderId, address indexed pair, uint256 price, uint256 threshold);
    event PriceCheck        (uint256 indexed orderId, uint256 price, uint256 threshold, bool triggered);
    event PairSubscribed    (address indexed pair);
    event PairUnsubscribed  (address indexed pair);

    // --- State ---
    address public immutable admin;
    address public immutable callbackContract;

    mapping(uint256 => TrackedOrder) public trackedOrders;
    mapping(address => uint256[])    public pairOrders;
    mapping(address => uint256)      public pairActiveCount;
    mapping(address => bool)         public subscribedPairs;

    // --- Modifiers ---
    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    // --- Constructor ---
    constructor(
        address _admin,
        address _callbackContract,
        address _initialPair
    ) payable {
        admin            = _admin;
        callbackContract = _callbackContract;

        // Subscribe to ArbitrumStopOrderCallback lifecycle events on Arbitrum
        _subscribeToCallback(uint256(ORDER_CREATED_TOPIC));
        _subscribeToCallback(uint256(ORDER_CANCELLED_TOPIC));
        _subscribeToCallback(uint256(ORDER_EXECUTED_TOPIC));
        _subscribeToCallback(uint256(ORDER_PAUSED_TOPIC));
        _subscribeToCallback(uint256(ORDER_RESUMED_TOPIC));

        // Pre-subscribe to initial pair
        if (_initialPair != address(0)) {
            service.subscribe(
                ARBITRUM_CHAIN_ID,
                _initialPair,
                SYNC_TOPIC,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
            subscribedPairs[_initialPair] = true;
            emit PairSubscribed(_initialPair);
        }
    }

    // --- IReactive entry point ---

    function react(LogRecord calldata log) external vmOnly {
        if (log._contract == callbackContract) {
            _processLifecycleEvent(log);
        } else if (log.topic_0 == SYNC_TOPIC && subscribedPairs[log._contract]) {
            _processSyncEvent(log);
        }
    }

    // --- Lifecycle event handlers ---

    function _processLifecycleEvent(LogRecord calldata log) internal {
        bytes32 t = bytes32(log.topic_0);

        if      (t == ORDER_CREATED_TOPIC)   { _onOrderCreated(log);   }
        else if (t == ORDER_CANCELLED_TOPIC) { _onOrderFinished(log, uint256(log.topic_1), OrderStatus.Cancelled); }
        else if (t == ORDER_EXECUTED_TOPIC)  { _onOrderFinished(log, uint256(log.topic_2), OrderStatus.Executed);  }
        else if (t == ORDER_PAUSED_TOPIC)    { _onOrderPaused(log);    }
        else if (t == ORDER_RESUMED_TOPIC)   { _onOrderResumed(log);   }
    }

    /**
     * @dev Decodes StopOrderCreated log and starts tracking.
     *      Indexed: topic_1=pair, topic_2=orderId, topic_3=user
     *      Data: bool sellToken0, address tokenSell, address tokenBuy,
     *            uint256 amount, uint256 coefficient, uint256 threshold, uint8 orderType
     */
    function _onOrderCreated(LogRecord calldata log) internal {
        address pair    = address(uint160(log.topic_1));
        uint256 orderId = uint256(log.topic_2);
        address user    = address(uint160(log.topic_3));

        (
            bool    sellToken0,
            /*tokenSell*/ ,
            /*tokenBuy*/  ,
            /*amount*/    ,
            uint256 coefficient,
            uint256 threshold,
            uint8   rawOrderType
        ) = abi.decode(log.data, (bool, address, address, uint256, uint256, uint256, uint8));

        trackedOrders[orderId] = TrackedOrder({
            id:             orderId,
            pair:           pair,
            sellToken0:     sellToken0,
            coefficient:    coefficient,
            threshold:      threshold,
            orderType:      OrderType(rawOrderType),
            status:         OrderStatus.Active,
            lastTriggeredAt: 0,
            triggerCount:   0
        });

        pairOrders[pair].push(orderId);
        pairActiveCount[pair]++;

        // Dynamically subscribe to this pair if not already subscribed
        if (!subscribedPairs[pair]) {
            _requestPairSubscription(pair);
        }

        emit OrderTracked(orderId, pair, user);
    }

    function _onOrderFinished(
        LogRecord calldata,
        uint256 orderId,
        OrderStatus finalStatus
    ) internal {
        TrackedOrder storage o = trackedOrders[orderId];
        if (o.id != orderId) return;

        address pair  = o.pair;
        o.status      = finalStatus;

        if (pairActiveCount[pair] > 0) {
            pairActiveCount[pair]--;
            if (pairActiveCount[pair] == 0) {
                _requestPairUnsubscription(pair);
            }
        }

        emit OrderUntracked(orderId, finalStatus);
    }

    function _onOrderPaused(LogRecord calldata log) internal {
        uint256 orderId = uint256(log.topic_1);
        TrackedOrder storage o = trackedOrders[orderId];
        if (o.id == orderId) {
            o.status = OrderStatus.Paused;
            if (pairActiveCount[o.pair] > 0) pairActiveCount[o.pair]--;
        }
    }

    function _onOrderResumed(LogRecord calldata log) internal {
        uint256 orderId = uint256(log.topic_1);
        TrackedOrder storage o = trackedOrders[orderId];
        if (o.id == orderId) {
            o.status = OrderStatus.Active;
            pairActiveCount[o.pair]++;
        }
    }

    // --- Price monitoring ---

    function _processSyncEvent(LogRecord calldata log) internal {
        address  pair = log._contract;
        Reserves memory res = abi.decode(log.data, (Reserves));

        uint256[] storage ids = pairOrders[pair];
        uint256 len = ids.length;

        for (uint256 i; i < len; i++) {
            uint256 orderId = ids[i];
            TrackedOrder storage o = trackedOrders[orderId];

            if (o.status != OrderStatus.Active) continue;

            // Respect trigger cooldown
            if (block.timestamp < o.lastTriggeredAt + TRIGGER_COOLDOWN) continue;

            // Fail-safe after too many attempts
            if (o.triggerCount >= MAX_TRIGGER_ATTEMPTS) {
                o.status = OrderStatus.Failed;
                emit OrderUntracked(orderId, OrderStatus.Failed);
                continue;
            }

            // Calculate current price
            uint256 price = o.sellToken0
                ? Math.mulDiv(uint256(res.reserve1), o.coefficient, uint256(res.reserve0))
                : Math.mulDiv(uint256(res.reserve0), o.coefficient, uint256(res.reserve1));

            bool conditionMet = o.orderType == OrderType.StopLoss
                ? price <= o.threshold
                : price >= o.threshold;

            emit PriceCheck(orderId, price, o.threshold, conditionMet);

            if (conditionMet) {
                o.lastTriggeredAt = block.timestamp;
                o.triggerCount++;

                // Fire callback -> ArbitrumStopOrderCallback.executeStopOrder()
                emit Callback(
                    ARBITRUM_CHAIN_ID,
                    callbackContract,
                    CALLBACK_GAS_LIMIT,
                    abi.encodeWithSignature(
                        "executeStopOrder(address,uint256)",
                        address(0),
                        orderId
                    )
                );

                emit ExecutionTriggered(orderId, pair, price, o.threshold);
            }
        }
    }

    // --- Dynamic pair subscription (self-callback pattern) ---

    function _requestPairSubscription(address pair) internal {
        emit Callback(
            REACTIVE_CHAIN_ID,
            address(this),
            CALLBACK_GAS_LIMIT,
            abi.encodeWithSignature("subscribeToPair(address,address)", address(0), pair)
        );
        subscribedPairs[pair] = true;
        emit PairSubscribed(pair);
    }

    function _requestPairUnsubscription(address pair) internal {
        emit Callback(
            REACTIVE_CHAIN_ID,
            address(this),
            CALLBACK_GAS_LIMIT,
            abi.encodeWithSignature("unsubscribeFromPair(address,address)", address(0), pair)
        );
        subscribedPairs[pair] = false;
        emit PairUnsubscribed(pair);
    }

    function subscribeToPair(address, address pair) external rnOnly {
        service.subscribe(
            ARBITRUM_CHAIN_ID, pair, SYNC_TOPIC,
            REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
    }

    function unsubscribeFromPair(address, address pair) external rnOnly {
        service.unsubscribe(
            ARBITRUM_CHAIN_ID, pair, SYNC_TOPIC,
            REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
    }

    // --- Admin emergency functions ---

    function emergencySubscribe(address pair) external onlyAdmin {
        service.subscribe(
            ARBITRUM_CHAIN_ID, pair, SYNC_TOPIC,
            REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        subscribedPairs[pair] = true;
        emit PairSubscribed(pair);
    }

    function emergencyUnsubscribe(address pair) external onlyAdmin {
        service.unsubscribe(
            ARBITRUM_CHAIN_ID, pair, SYNC_TOPIC,
            REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        subscribedPairs[pair] = false;
        emit PairUnsubscribed(pair);
    }

    function withdrawETH(address payable to, uint256 amount) external onlyAdmin {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    function getActiveOrderIds(address pair) external view returns (uint256[] memory) {
        uint256[] storage all = pairOrders[pair];
        uint256 cnt;
        for (uint256 i; i < all.length; i++) {
            if (trackedOrders[all[i]].status == OrderStatus.Active) cnt++;
        }
        uint256[] memory active = new uint256[](cnt);
        uint256 idx;
        for (uint256 i; i < all.length; i++) {
            if (trackedOrders[all[i]].status == OrderStatus.Active) active[idx++] = all[i];
        }
        return active;
    }

    function _subscribeToCallback(uint256 topic) private {
        service.subscribe(
            ARBITRUM_CHAIN_ID,
            callbackContract,
            topic,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
    }
}
