export interface TrackedStock {
  symbol: string;
  name: string;
  igSpread: number; // typical IG spread in points
}

export const TRACKED_STOCKS: TrackedStock[] = [
  { symbol: "TSLA",  name: "Tesla",           igSpread: 0.25 },
  { symbol: "NVDA",  name: "Nvidia",          igSpread: 0.25 },
  { symbol: "AMD",   name: "AMD",             igSpread: 0.10 },
  { symbol: "META",  name: "Meta",            igSpread: 0.25 },
  { symbol: "AAPL",  name: "Apple",           igSpread: 0.10 },
  { symbol: "MSFT",  name: "Microsoft",       igSpread: 0.10 },
  { symbol: "AMZN",  name: "Amazon",          igSpread: 0.25 },
  { symbol: "GOOGL", name: "Alphabet",        igSpread: 0.25 },
  { symbol: "NFLX",  name: "Netflix",         igSpread: 0.50 },
  { symbol: "PLTR",  name: "Palantir",        igSpread: 0.05 },
  { symbol: "COIN",  name: "Coinbase",        igSpread: 0.50 },
  { symbol: "SQ",    name: "Block",           igSpread: 0.25 },
  { symbol: "SHOP",  name: "Shopify",         igSpread: 0.25 },
  { symbol: "RIVN",  name: "Rivian",          igSpread: 0.05 },
  { symbol: "SNAP",  name: "Snap",            igSpread: 0.05 },

  { symbol: "ABNB",  name: "Airbnb",          igSpread: 0.50 },
  { symbol: "RDDT",  name: "Reddit",          igSpread: 0.25 },
  { symbol: "MSTR",  name: "MicroStrategy",   igSpread: 1.00 },
  { symbol: "ARM",   name: "Arm Holdings",    igSpread: 0.50 },
  { symbol: "SMCI",  name: "Super Micro",     igSpread: 0.50 },
  { symbol: "RBLX",  name: "Roblox",          igSpread: 0.05 },
  { symbol: "DASH",  name: "DoorDash",        igSpread: 0.25 },
  { symbol: "ZM",    name: "Zoom",            igSpread: 0.25 },
  { symbol: "BABA",  name: "Alibaba",         igSpread: 0.25 },
];

export const SYMBOLS = TRACKED_STOCKS.map(s => s.symbol);

export const TRIGGER_PCT = 4;      // % move that triggers trade
export const TAKE_PROFIT_PCT = 1;  // % gain to auto-close (quick scalp)
export const STOP_LOSS_PCT = 2;    // % loss to auto-close (2:1 risk:reward, need 67% win rate)
export const STARTING_BANKROLL = 10_000; // £
export const STAKE_PER_POINT = 1;  // £ per point default stake

/**
 * STRATEGY: Mechanical Mean Reversion — no AI delay
 *
 * 1. Stock moves 4%+ intraday → auto-trigger
 * 2. ALWAYS fade the move:
 *    - Stock DOWN 4%+ → BUY (expect bounce)
 *    - Stock UP 4%+ → SHORT (expect fade)
 * 3. Take profit at +1% (quick scalp, high hit rate)
 * 4. Stop loss at -2% (tight risk management)
 * 5. Close all positions at market close
 * 6. AI runs post-trade analysis on every closed position:
 *    what went right/wrong, what we could improve
 */
