"use client";

import { useIGStream } from "@/lib/useIGStream";
import type { StreamPriceMap } from "@/lib/useIGStream";
import { useEffect } from "react";

interface Props {
  onPrices: (prices: StreamPriceMap) => void;
  onStatus: (connected: boolean, error: string | null) => void;
}

export default function IGStreamProvider({ onPrices, onStatus }: Props) {
  const { prices, connected, error } = useIGStream();

  useEffect(() => { onPrices(prices); }, [prices, onPrices]);
  useEffect(() => { onStatus(connected, error); }, [connected, error, onStatus]);

  return null;
}
