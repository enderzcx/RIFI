// Configurable risk thresholds — change these without touching hook logic

export const RISK_CONFIG = {
  // --- Amount limits ---
  maxSwapWeth: 0.5,           // max single swap in WETH (sell side)
  maxSwapUsdc: 1000,          // max single swap in USDC (buy side)
  maxStopLossWeth: 1.0,       // max single stop-loss amount in WETH

  // --- Balance guards ---
  minEthForGas: 0.001,        // minimum ETH to keep for gas
  minWethReserve: 0.0005,     // don't sell if WETH would drop below this
  minUsdcReserve: 1,          // don't buy if USDC would drop below this

  // --- Cooldown ---
  tradeCooldownMs: 30_000,    // minimum 30s between trades per wallet
  samePairCooldownMs: 60_000, // minimum 60s for same direction on same pair

  // --- Session guards ---
  sessionBudgetWarnPct: 0.9,  // warn when 90% of session budget spent
  maxTradesPerSession: 50,    // max trades in a single session

  // --- Price guards ---
  maxSlippagePct: 2.0,        // max acceptable slippage %
  priceStaleMs: 60_000,       // price data older than 60s = stale

  // --- SL:TP ratio (@formnoshape's discipline) ---
  minSlTpRatio: 2.0,          // minimum SL:TP = 1:2 (risk $1 to make $2)
} as const

export type RiskConfig = typeof RISK_CONFIG
