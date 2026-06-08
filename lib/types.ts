export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  marketCap?: number;
  updatedAt: string; // ISO
  marketOpen: boolean;
}

export interface NewsItem {
  symbol: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string; // ISO
  sentiment?: "positive" | "negative" | "neutral";
}

export type Direction = "LONG" | "SHORT";
export type AIDecision = Direction | "AVOID";

export interface AIAnalysis {
  id: string;
  symbol: string;
  name: string;
  direction: AIDecision;
  confidence: number; // 0-100
  reasoning: string;
  triggerPrice: number;
  triggerChangePercent: number;
  stakePerPoint: number; // £/point recommended
  newsHeadlines: string[];
  timestamp: string; // ISO
}

export type PositionStatus = "open" | "closed";
export type CloseReason = "take_profit" | "stop_loss" | "end_of_day" | "ai_exit" | "manual";

export interface Position {
  id: string;
  symbol: string;
  name: string;
  direction: Direction;
  entryPrice: number;
  currentPrice: number;
  exitPrice?: number;
  stakePerPoint: number; // £/point
  pnl: number; // £
  pnlPercent: number;
  status: PositionStatus;
  entryTime: string;
  exitTime?: string;
  closeReason?: CloseReason;
  aiAnalysisId: string;
  igSpread: number;
}

export interface Portfolio {
  cash: number;
  startingCash: number;
  totalPnl: number;
  totalPnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}
