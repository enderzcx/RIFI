import type { ChatCompletionTool } from 'openai/resources/chat/completions'

export const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_market_signals',
      description: 'Get latest market intelligence signals from 27+ data sources (geopolitics, macro, crypto news, social sentiment). Returns preprocessed structured signals with risk scores and alerts.',
      parameters: { type: 'object', properties: {}, required: [] },
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
          section: { type: 'string', enum: ['profile', 'patterns', 'decisions'], description: 'profile = user preferences/risk tolerance, patterns = trading lessons learned, decisions = important trade records' },
          content: { type: 'string', description: 'Content to add to memory' },
        },
        required: ['section', 'content'],
      },
    },
  },
]
