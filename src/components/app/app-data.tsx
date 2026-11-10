"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Conversation, PublicModel, Wallet } from "@/lib/types";

export interface AppStatus {
  frontierPaused: boolean;
  plan: "free" | "pro";
  dailyAllowance: number;
  unmeteredUsedToday: number;
  unmeteredDailyCap: number;
  compareEnabled: boolean;
  compareMaxModels: number;
}

interface AppData {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  wallet: Wallet | null;
  models: PublicModel[];
  status: AppStatus | null;
  search: string;
  setSearch: (q: string) => void;
  refreshConversations: () => Promise<void>;
  refreshMe: () => Promise<void>;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: string) => void;
  setWallet: (w: Wallet) => void;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children, plan }: { children: React.ReactNode; plan: "free" | "pro" }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setLoaded] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [models, setModels] = useState<PublicModel[]>([]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [search, setSearch] = useState("");

  const refreshConversations = useCallback(async () => {
    const res = await fetch(`/api/conversations?q=${encodeURIComponent(search)}`, { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setConversations(json.conversations);
    }
    setLoaded(true);
  }, [search]);

  const refreshMe = useCallback(async () => {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setWallet(json.wallet);
    setModels(json.models);
    setStatus(json.status);
  }, []);

  useEffect(() => {
    const t = setTimeout(refreshConversations, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refreshConversations, search]);

  useEffect(() => {
    refreshMe();
    // Refresh balances periodically (e.g. after the daily reset).
    const t = setInterval(refreshMe, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshMe, plan]);

  const upsertConversation = useCallback((c: Conversation) => {
    setConversations((prev) => [c, ...prev.filter((p) => p.id !== c.id)]);
  }, []);
  const removeConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      conversations,
      conversationsLoaded,
      wallet,
      models,
      status,
      search,
      setSearch,
      refreshConversations,
      refreshMe,
      upsertConversation,
      removeConversation,
      setWallet,
    }),
    [conversations, conversationsLoaded, wallet, models, status, search, refreshConversations, refreshMe, upsertConversation, removeConversation],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData must be used inside AppDataProvider");
  return v;
}
