"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TRACKED_STOCKS } from "./stocks";

export interface StreamPrice {
  bid: number;
  offer: number;
  changePercent: number;
  high: number;
  low: number;
  marketState: string; // "TRADEABLE" | "CLOSED" | "AUCTION" etc
  updatedAt: string;
}

export type StreamPriceMap = Record<string, StreamPrice>; // keyed by symbol

type LSClient = InstanceType<typeof import("lightstreamer-client-web").LightstreamerClient>;

export function useIGStream() {
  const [prices, setPrices] = useState<StreamPriceMap>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LSClient | null>(null);

  const connect = useCallback(async () => {
    // Dynamically import so it never runs server-side
    const { LightstreamerClient, Subscription } = await import("lightstreamer-client-web");

    try {
      const res = await fetch("/api/ig-stream-credentials");
      if (!res.ok) {
        setError(`Stream credentials unavailable (${res.status})`);
        return;
      }
      const { cst, securityToken, accountId, lightstreamerEndpoint, error: credError } = await res.json();
      if (credError) { setError(`Stream: ${credError}`); return; }
      if (!cst || !securityToken) { setError("Stream: missing session tokens"); return; }

      if (clientRef.current) {
        clientRef.current.disconnect();
      }

      const client = new LightstreamerClient(lightstreamerEndpoint, "DEFAULT");
      // IG auth: password is "CST-{cst}|XST-{securityToken}"
      client.connectionDetails.setUser(accountId);
      client.connectionDetails.setPassword(`CST-${cst}|XST-${securityToken}`);

      client.addListener({
        onStatusChange(status: string) {
          setConnected(status.startsWith("CONNECTED"));
          if (status.startsWith("DISCONNECTED")) setError("Stream disconnected — reconnecting...");
          if (status.startsWith("CONNECTED")) setError(null);
        },
      });

      // Subscribe to MARKET items for each tracked stock
      const items = TRACKED_STOCKS.map(s => `MARKET:${s.igEpic}`);
      const fields = ["BID", "OFFER", "CHANGE_PCT", "HIGH", "LOW", "MARKET_STATE", "UPDATE_TIME"];

      const sub = new Subscription("MERGE", items, fields);
      sub.setDataAdapter("DEFAULT");
      sub.setRequestedSnapshot("yes");

      sub.addListener({
        onItemUpdate(update: {
          getItemName(): string;
          getValue(field: string): string | null;
        }) {
          const epic = update.getItemName().replace("MARKET:", "");
          const stock = TRACKED_STOCKS.find(s => s.igEpic === epic);
          if (!stock) return;

          const bid = parseFloat(update.getValue("BID") ?? "0") || 0;
          const offer = parseFloat(update.getValue("OFFER") ?? "0") || 0;
          const changePercent = parseFloat(update.getValue("CHANGE_PCT") ?? "0") || 0;
          const high = parseFloat(update.getValue("HIGH") ?? "0") || 0;
          const low = parseFloat(update.getValue("LOW") ?? "0") || 0;
          const marketState = update.getValue("MARKET_STATE") ?? "UNKNOWN";

          if (bid === 0 && offer === 0) return;

          setPrices(prev => ({
            ...prev,
            [stock.symbol]: { bid, offer, changePercent, high, low, marketState, updatedAt: new Date().toISOString() },
          }));
        },
      });

      client.subscribe(sub);
      client.connect();
      clientRef.current = client;
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    // Only run in browser — never during SSR
    if (typeof window === "undefined") return;
    connect().catch(err => setError(String(err)));
    return () => {
      try { clientRef.current?.disconnect(); } catch { /* ignore */ }
    };
  }, [connect]);

  return { prices, connected, error, reconnect: connect };
}
