import type { ChatCompletionTool } from 'openai/resources/chat/completions'

export const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_market_signals',
      description: 'Get latest market intelligence signals from 27+ data sources (geopolitics, macro, crypto news, social sentiment). Returns preprocessed structured signals with risk scores and alerts. Use mode="stock" for US equity market analysis.',
      parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['crypto', 'stock'], description: 'Analysis mode: crypto (default) or stock (US equities)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_price',
      description: 'Get current WETH/USDC price from Uniswap V2 on Base chain. Returns price in USD (e.g., 2118 = $2,118 per ETH).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_portfolio',
      description: 'Get current portfolio: WETH balance, USDC balance, ETH (gas) balance on Base chain.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'market_swap',
      description: 'Execute a market swap on Uniswap V2 (Base). Buy WETH with USDC or sell WETH for USDC.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'], description: 'buy = buy WETH with USDC, sell = sell WETH for USDC' },
          amount: { type: 'string', description: 'Amount to swap. For buy: USDC amount (e.g., "100"). For sell: WETH amount (e.g., "0.05").' },
        },
        required: ['direction', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_stop_loss',
      description: 'Set a stop-loss order via Reactive Smart Contract. When WETH price drops to the threshold, automatically sells WETH for USDC on-chain (decentralized, no backend needed).',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'string', description: 'WETH amount to sell when triggered (e.g., "0.01")' },
          threshold: { type: 'number', description: 'Price threshold in USD. When price <= threshold, order triggers. E.g., 2000 means sell if ETH drops to $2,000.' },
        },
        required: ['amount', 'threshold'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_take_profit',
      description: 'Set a take-profit order via Reactive Smart Contract. When WETH price rises to the threshold, automatically sells WETH for USDC on-chain.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'string', description: 'WETH amount to sell when triggered (e.g., "0.01")' },
          threshold: { type: 'number', description: 'Price threshold in USD. When price >= threshold, order triggers. E.g., 2500 means sell if ETH rises to $2,500.' },
        },
        required: ['amount', 'threshold'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_orders',
      description: 'Get all active stop-loss and take-profit orders for this wallet.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_order',
      description: 'Cancel a stop-loss or take-profit order by revoking the token approval to the callback contract. The Reactive contract will still exist but cannot execute without allowance.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'number', description: 'The order ID to cancel (from get_active_orders)' },
        },
        required: ['orderId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_session',
      description: 'Get the current session key status for this wallet: remaining budget, daily limit, expiry, whether AI can trade autonomously.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'session_swap',
      description: 'Execute a swap via SessionManager (requires active session key). AI uses this for autonomous trading within the user-approved budget. Tokens go directly back to user wallet.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'], description: 'buy = buy WETH with USDC, sell = sell WETH for USDC' },
          amount: { type: 'string', description: 'Amount to swap. For buy: USDC amount. For sell: WETH amount.' },
        },
        required: ['direction', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_memory',
      description: 'Update AI memory about this user. Use to remember trading preferences, risk tolerance, successful patterns, and important decisions. Memory persists across sessions.',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', enum: ['profile', 'patterns', 'decisions', 'market_regime', 'strategy_feedback', 'risk_lesson', 'reference'], description: 'profile = user preferences, patterns = trading lessons, decisions = trade records, market_regime = current market state (auto-expires 3d), strategy_feedback = strategy performance notes (30d), risk_lesson = permanent risk lessons, reference = external resource pointers' },
          content: { type: 'string', description: 'Content to add to memory' },
        },
        required: ['section', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_crypto_news',
      description: 'Get latest AI-scored crypto news from OpenNews (6551.io). Each news item has a sentiment score (0-100) and directional signal (long/short/neutral). Use when user asks about news, recent events, or market catalysts.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of news items to return (default 10, max 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_crucix_data',
      description: 'Get raw macro and geopolitical data from Crucix 27-source OSINT engine. Returns: market prices (VIX, BTC, ETH, S&P500, Gold), energy (WTI oil, natural gas), conflict data (ACLED events/fatalities), Telegram urgent signals, and more. Use for detailed macro breakdown beyond the summary in get_market_signals.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_onchain_data',
      description: 'Get on-chain analytics for a token: whale movements, holder distribution, smart money flows, DEX volume. Powered by OnchainOS. Use for technical and on-chain analysis.',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token symbol, e.g. ETH, BTC' },
        },
        required: ['token'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lifi_swap',
      description: 'Cross-chain swap via LiFi aggregator (60+ chains, any token pair). Use for: cross-chain transfers, buying tokenized US stocks on BSC (AAPLon=Apple, NVDAon=NVIDIA, TSLAon=Tesla, SPYon=S&P500), swapping tokens not available on Base Uniswap. BSC has cheapest gas for stock tokens.',
      parameters: {
        type: 'object',
        properties: {
          from_chain: { type: 'string', enum: ['base', 'ethereum', 'bsc'], description: 'Source chain' },
          to_chain: { type: 'string', enum: ['base', 'ethereum', 'bsc'], description: 'Destination chain' },
          from_token: { type: 'string', description: 'Source token symbol (USDC, WETH, ETH) or contract address' },
          to_token: { type: 'string', description: 'Destination token symbol or contract address' },
          amount: { type: 'string', description: 'Amount in human-readable units (e.g. "100" for 100 USDC)' },
        },
        required: ['from_chain', 'to_chain', 'from_token', 'to_token', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bitget_trade',
      description: 'Trade on Bitget CEX. Supports spot and USDT-margined futures. Use for: buying/selling crypto with deep liquidity, opening/closing futures positions with leverage. Account has USDT balance.',
      parameters: {
        type: 'object',
        properties: {
          market: { type: 'string', enum: ['spot', 'futures'], description: 'Market type' },
          symbol: { type: 'string', description: 'Trading pair, e.g. BTCUSDT, ETHUSDT, SOLUSDT' },
          side: { type: 'string', enum: ['buy', 'sell'], description: 'Buy or sell' },
          amount: { type: 'string', description: 'Amount (in base currency for spot, contracts for futures)' },
          order_type: { type: 'string', enum: ['market', 'limit'], description: 'Order type (default: market)' },
          price: { type: 'string', description: 'Limit price (required for limit orders)' },
          leverage: { type: 'number', description: 'Leverage for futures (e.g. 5, 10, 20). Default: exchange default' },
        },
        required: ['market', 'symbol', 'side', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bitget_account',
      description: 'Get Bitget account info: balances (spot + futures), open positions, or price ticker. Use before trading to check available funds.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['balance', 'positions', 'ticker'], description: 'What to query' },
          symbol: { type: 'string', description: 'Symbol for ticker query (e.g. BTCUSDT)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_strategy',
      description: 'Create, list, or update trading strategies. The Strategist Agent evaluates active strategies against market conditions every 15 minutes. Examples: "DCA into ETH at $1800-1900", "Grid trade BTC $58k-62k", "Stop if VIX > 30".',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'update', 'cancel'], description: 'Action to perform' },
          goal: { type: 'string', description: 'Strategy goal in natural language (for create)' },
          template: { type: 'string', enum: ['grid', 'dca', 'ma_cross', 'trend', 'event', 'custom'], description: 'Strategy template (for create, default: custom)' },
          params: { type: 'object', description: 'Strategy parameters (price range, amounts, etc.)' },
          strategy_id: { type: 'number', description: 'Strategy ID (for update/cancel)' },
          status: { type: 'string', description: 'New status (for update): active, paused, cancelled' },
        },
        required: ['action'],
      },
    },
  },
]
