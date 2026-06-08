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
  { symbol: "SPOT",  name: "Spotify",         igSpread: 0.50 },
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

export const TRIGGER_PCT = 3;      // % move that triggers AI analysis
export const TAKE_PROFIT_PCT = 4;  // % gain to auto-close
export const STOP_LOSS_PCT = 4;    // % loss to auto-close
export const STARTING_BANKROLL = 10_000; // £
export const STAKE_PER_POINT = 1;  // £ per point default stake
