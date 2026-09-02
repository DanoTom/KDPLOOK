import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AppSettings, Marketplace } from "../shared/types";
import { api } from "./api";

interface Toast {
  id: number;
  tone: "good" | "bad" | "info";
  message: string;
}

interface AppState {
  settings: AppSettings | null;
  marketplaces: Marketplace[];
  loading: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  reloadSettings: () => Promise<void>;
  toast: (message: string, tone?: Toast["tone"]) => void;
  currencySymbol: string;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5200);
  }, []);

  const reloadSettings = useCallback(async () => {
    const next = await api.getSettings();
    setSettings(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loaded, markets] = await Promise.all([api.getSettings(), api.marketplaces()]);
        if (cancelled) return;
        setSettings(loaded);
        setMarketplaces(markets);
      } catch {
        // The shell renders regardless; individual screens surface their errors.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (settings?.theme) document.documentElement.dataset.theme = settings.theme;
  }, [settings?.theme]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    // Optimistic: the scoring engine runs client-side, so the UI re-scores
    // immediately while the write lands in D1.
    setSettings((current) => (current ? { ...current, ...patch, printing: { ...current.printing, ...(patch.printing ?? {}) } } : current));
    try {
      const saved = await api.saveSettings(patch);
      setSettings(saved);
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudieron guardar los ajustes", "bad");
      await reloadSettings();
    }
  }, [toast, reloadSettings]);

  const currencySymbol = useMemo(() => {
    if (!settings) return "$";
    return marketplaces.find((m) => m.id === settings.marketplace)?.currencySymbol ?? "$";
  }, [settings, marketplaces]);

  const value = useMemo<AppState>(
    () => ({ settings, marketplaces, loading, updateSettings, reloadSettings, toast, currencySymbol }),
    [settings, marketplaces, loading, updateSettings, reloadSettings, toast, currencySymbol],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.tone}`}>{item.message}</div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

/** Settings are always loaded before the screens render, so this narrows the type. */
export function useSettings(): AppSettings {
  const { settings } = useApp();
  if (!settings) throw new Error("Settings not loaded");
  return settings;
}
