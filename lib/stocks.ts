export interface TrackedStock {
  symbol: string;
  name: string;
  igEpic: string;       // IG's unique market identifier
  igSpread: number;      // typical IG spread in points
}

// Only stocks confirmed available on IG demo with valid EPICs
export const TRACKED_STOCKS: TrackedStock[] = [
  // ── Big Tech ──
  { symbol: "TSLA",  name: "Tesla",           igEpic: "UD.D.TSLA.CASH.IP",     igSpread: 0.25 },
  { symbol: "NVDA",  name: "Nvidia",          igEpic: "UC.D.NVDA.CASH.IP",     igSpread: 0.25 },
  { symbol: "AMD",   name: "AMD",             igEpic: "SA.D.AMD.CASH.IP",      igSpread: 0.10 },
  { symbol: "META",  name: "Meta",            igEpic: "UB.D.FB.CASH.IP",       igSpread: 0.25 },
  { symbol: "AAPL",  name: "Apple",           igEpic: "UA.D.AAPL.CASH.IP",     igSpread: 0.10 },
  { symbol: "MSFT",  name: "Microsoft",       igEpic: "UC.D.MSFT.CASH.IP",     igSpread: 0.10 },
  { symbol: "AMZN",  name: "Amazon",          igEpic: "UA.D.AMZN.CASH.IP",     igSpread: 0.25 },
  { symbol: "GOOGL", name: "Alphabet",        igEpic: "UB.D.GOOGL.CASH.IP",    igSpread: 0.25 },
  { symbol: "NFLX",  name: "Netflix",         igEpic: "UC.D.NFLX.CASH.IP",     igSpread: 0.50 },

  // ── High Volatility ──
  { symbol: "PLTR",  name: "Palantir",        igEpic: "SE.D.PLTRUS.CASH.IP",   igSpread: 0.05 },
  { symbol: "COIN",  name: "Coinbase",        igEpic: "UA.D.COINUS.CASH.IP",   igSpread: 0.50 },
  { symbol: "RIVN",  name: "Rivian",          igEpic: "UC.D.RIVNUS.CASH.IP",   igSpread: 0.05 },
  { symbol: "MSTR",  name: "MicroStrategy",   igEpic: "UC.D.MSTR.CASH.IP",     igSpread: 1.00 },
  { symbol: "ARM",   name: "Arm Holdings",    igEpic: "UA.D.ARMUS.CASH.IP",    igSpread: 0.50 },
  { symbol: "SMCI",  name: "Super Micro",     igEpic: "UD.D.SMCIUS.CASH.IP",   igSpread: 0.50 },
  { symbol: "ABNB",  name: "Airbnb",          igEpic: "UA.D.ABNBUS.CASH.IP",   igSpread: 0.50 },
  { symbol: "ZM",    name: "Zoom",            igEpic: "UD.D.ZMUS.CASH.IP",     igSpread: 0.25 },
  { symbol: "BABA",  name: "Alibaba",         igEpic: "AC.D.9988HK.CASH.IP",   igSpread: 0.25 },

  // ── Replacements for stocks not on IG (SQ, SHOP, SNAP, RDDT, RBLX, DASH) ──
  { symbol: "PYPL",  name: "PayPal",          igEpic: "UC.D.PYPL.CASH.IP",     igSpread: 0.10 },
  { symbol: "UBER",  name: "Uber",            igEpic: "UC.D.UBERUS.CASH.IP",   igSpread: 0.10 },
  { symbol: "BA",    name: "Boeing",          igEpic: "UC.D.BAUS.CASH.IP",     igSpread: 0.25 },
  { symbol: "NIO",   name: "NIO Inc",         igEpic: "UC.D.NIOUS.CASH.IP",    igSpread: 0.05 },
  { symbol: "INTC",  name: "Intel",           igEpic: "UC.D.INTC.CASH.IP",     igSpread: 0.05 },
  { symbol: "CRM",   name: "Salesforce",      igEpic: "UC.D.CRM.CASH.IP",      igSpread: 0.25 },

  // ── Additional High Volatility (6 new) ──
  { symbol: "SOFI",  name: "SoFi Technologies", igEpic: "TBD",                  igSpread: 0.25 },
  { symbol: "MARA",  name: "Marathon Digital",  igEpic: "TBD",                  igSpread: 0.50 },
  { symbol: "RIOT",  name: "Riot Platforms",    igEpic: "TBD",                  igSpread: 0.50 },
  { symbol: "DDOG",  name: "Datadog",           igEpic: "TBD",                  igSpread: 0.25 },
  { symbol: "SNOW",  name: "Snowflake",         igEpic: "TBD",                  igSpread: 0.50 },
  { symbol: "AVGO",  name: "Broadcom",          igEpic: "TBD",                  igSpread: 0.10 },
];

export const SYMBOLS = TRACKED_STOCKS.map(s => s.symbol);

export const TRIGGER_PCT = 4;      // % move that triggers trade
export const TAKE_PROFIT_PCT = 1;  // % gain to auto-close (quick scalp)
export const STOP_LOSS_PCT = 2;    // % loss to auto-close (2:1 risk:reward, need 67% win rate)
export const STARTING_BANKROLL = 10_000; // £
export const STAKE_PER_POINT = 1;  // £ per point default stake

/**
 * STRATEGY: Mechanical Mean Reversion via IG Demo
 *
 * 1. Poll IG for live prices on all 24 stocks
 * 2. Stock moves 4%+ intraday → auto-trigger
 * 3. FADE the move: UP → SELL, DOWN → BUY
 * 4. Place real spread bet on IG demo via API
 * 5. IG handles execution, spreads, P&L
 * 6. Take profit at +1% / Stop loss at -2%
 * 7. AI reviews every closed trade → builds playbook
 */
