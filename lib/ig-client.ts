/**
 * IG Trading API Client — Demo Environment
 * Handles authentication, market search, and order execution.
 * All credentials stay server-side (never sent to browser).
 */

const IG_DEMO_URL = "https://demo-api.ig.com/gateway/deal";

interface IGSession {
  cst: string;           // Client Session Token
  securityToken: string; // X-SECURITY-TOKEN
  accountId: string;
  expiresAt: number;     // timestamp
}

let cachedSession: IGSession | null = null;

/** Authenticate with IG and get session tokens */
export async function igLogin(): Promise<IGSession> {
  // Return cached session if still valid (sessions last ~6 hours)
  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return cachedSession;
  }

  const apiKey = process.env.IG_API_KEY;
  const username = process.env.IG_USERNAME;
  const password = process.env.IG_PASSWORD;

  if (!apiKey || !username || !password) {
    throw new Error("IG credentials not configured");
  }

  const res = await fetch(`${IG_DEMO_URL}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json; charset=UTF-8",
      "X-IG-API-KEY": apiKey,
      "VERSION": "2",
    },
    body: JSON.stringify({
      identifier: username,
      password: password,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`IG login failed (${res.status}): ${err}`);
  }

  const cst = res.headers.get("CST") ?? "";
  const securityToken = res.headers.get("X-SECURITY-TOKEN") ?? "";
  const data = await res.json();

  cachedSession = {
    cst,
    securityToken,
    accountId: data.currentAccountId ?? process.env.IG_ACCOUNT_ID ?? "",
    expiresAt: Date.now() + 5 * 60 * 60 * 1000, // 5 hours
  };

  return cachedSession;
}

/** Make an authenticated IG API request */
async function igFetch(path: string, options: {
  method?: string;
  body?: unknown;
  version?: string;
} = {}): Promise<Response> {
  const session = await igLogin();
  const apiKey = process.env.IG_API_KEY!;

  return fetch(`${IG_DEMO_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json; charset=UTF-8",
      "X-IG-API-KEY": apiKey,
      "CST": session.cst,
      "X-SECURITY-TOKEN": session.securityToken,
      "VERSION": options.version ?? "1",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

// ── Market Search ────────────────────────────────────────────────────────────

export interface IGMarket {
  epic: string;          // IG's unique market identifier
  instrumentName: string;
  instrumentType: string;
  expiry: string;
  bid: number;
  offer: number;
  high: number;
  low: number;
  percentageChange: number;
  scalingFactor: number;
}

/** Search for a market by name/symbol — returns the best match */
export async function igSearchMarket(searchTerm: string): Promise<IGMarket | null> {
  const res = await igFetch(`/markets?searchTerm=${encodeURIComponent(searchTerm)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const markets = data.markets ?? [];

  // Find the DFB (Daily Funded Bet) or nearest spread bet market
  const match = markets.find((m: Record<string, unknown>) =>
    (m.expiry === "DFB" || m.expiry === "-") &&
    (m.instrumentType === "SHARES" || m.instrumentType === "CURRENCIES")
  ) ?? markets[0];

  if (!match) return null;

  return {
    epic: match.epic,
    instrumentName: match.instrumentName,
    instrumentType: match.instrumentType,
    expiry: match.expiry ?? "DFB",
    bid: match.bid ?? 0,
    offer: match.offer ?? 0,
    high: match.high ?? 0,
    low: match.low ?? 0,
    percentageChange: match.percentageChange ?? 0,
    scalingFactor: match.scalingFactor ?? 1,
  };
}

// ── Trading ──────────────────────────────────────────────────────────────────

export interface IGOpenResult {
  dealReference: string;
  dealId?: string;
  dealStatus?: string;
  reason?: string;
}

/** Open a spread bet position on IG demo */
export async function igOpenPosition(params: {
  epic: string;
  direction: "BUY" | "SELL";
  size: number;         // e.g. 1 = £1/point
  stopDistance?: number; // in points
  limitDistance?: number; // in points
  expiry?: string;      // "DFB" for Daily Funded Bet
}): Promise<IGOpenResult> {
  const res = await igFetch("/positions/otc", {
    method: "POST",
    version: "2",
    body: {
      epic: params.epic,
      direction: params.direction,
      size: params.size,
      orderType: "MARKET",
      expiry: params.expiry ?? "DFB",
      guaranteedStop: false,
      stopDistance: params.stopDistance ?? null,
      limitDistance: params.limitDistance ?? null,
      forceOpen: true,
      currencyCode: "GBP",
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`IG order failed: ${data.errorCode ?? res.status}`);
  }

  // Confirm the deal
  const dealRef = data.dealReference;
  if (dealRef) {
    const confirmRes = await igFetch(`/confirms/${dealRef}`);
    if (confirmRes.ok) {
      const confirm = await confirmRes.json();
      return {
        dealReference: dealRef,
        dealId: confirm.dealId,
        dealStatus: confirm.dealStatus,
        reason: confirm.reason,
      };
    }
  }

  return { dealReference: dealRef ?? "unknown" };
}

/** Close a position on IG demo */
export async function igClosePosition(dealId: string, direction: "BUY" | "SELL", size: number): Promise<{ success: boolean; reason?: string }> {
  // IG uses the opposite direction to close
  const closeDirection = direction === "BUY" ? "SELL" : "BUY";
  const session = await igLogin();

  // IG REST API requires POST with _method=DELETE header to close positions
  const res = await fetch(`${IG_DEMO_URL}/positions/otc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json; charset=UTF-8",
      "X-IG-API-KEY": process.env.IG_API_KEY!,
      "CST": session.cst,
      "X-SECURITY-TOKEN": session.securityToken,
      "VERSION": "1",
      "_method": "DELETE",
    },
    body: JSON.stringify({
      dealId,
      direction: closeDirection,
      size,
      orderType: "MARKET",
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { success: false, reason: `HTTP ${res.status}: ${errText}` };
  }

  const data = await res.json();
  const dealRef = data.dealReference;

  // Confirm the close
  if (dealRef) {
    try {
      const confirmRes = await igFetch(`/confirms/${dealRef}`);
      if (confirmRes.ok) {
        const confirm = await confirmRes.json();
        if (confirm.dealStatus === "ACCEPTED") {
          return { success: true, reason: `Closed: ${confirm.dealId}` };
        }
        return { success: false, reason: confirm.reason ?? "Rejected" };
      }
    } catch { /* fall through */ }
  }

  return { success: true, reason: dealRef ?? "unknown" };
}

// ── Account Info ─────────────────────────────────────────────────────────────

export interface IGAccountInfo {
  accountId: string;
  accountName: string;
  balance: number;
  deposit: number;
  profitLoss: number;
  available: number;
}

/** Get account balance and P&L from IG */
export async function igGetAccount(): Promise<IGAccountInfo | null> {
  try {
    const res = await igFetch("/accounts");
    if (!res.ok) return null;
    const data = await res.json();
    const account = (data.accounts ?? []).find((a: Record<string, unknown>) =>
      a.accountId === process.env.IG_ACCOUNT_ID
    ) ?? data.accounts?.[0];

    if (!account) return null;
    const bal = account.balance ?? {};
    return {
      accountId: account.accountId,
      accountName: account.accountName ?? "Demo",
      balance: bal.balance ?? 0,
      deposit: bal.deposit ?? 0,
      profitLoss: bal.profitLoss ?? 0,
      available: bal.available ?? 0,
    };
  } catch {
    return null;
  }
}

/** Get all open positions from IG */
export async function igGetPositions(): Promise<Array<{
  dealId: string;
  epic: string;
  direction: string;
  size: number;
  level: number;
  profitLoss: number;
  currency: string;
  instrumentName: string;
}>> {
  try {
    const res = await igFetch("/positions", { version: "2" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.positions ?? []).map((p: Record<string, unknown>) => {
      const pos = p.position as Record<string, unknown> ?? {};
      const mkt = p.market as Record<string, unknown> ?? {};
      return {
        dealId: pos.dealId ?? "",
        epic: mkt.epic ?? "",
        direction: pos.direction ?? "",
        size: pos.size ?? 0,
        level: pos.level ?? 0,
        profitLoss: pos.profitLoss ?? 0,
        currency: pos.currency ?? "GBP",
        instrumentName: mkt.instrumentName ?? "",
      };
    });
  } catch {
    return [];
  }
}
