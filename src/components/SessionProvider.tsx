"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { Ctx } from "./ui";

export type LaunchKind = "clean" | "mistakes" | "change";
export interface ServerStatus { llm: boolean; label: string }

const pad = (n: number) => String(n).padStart(2, "0");
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

interface SessionValue {
  today: string; setToday: (d: string) => void;
  offline: boolean; setOffline: (o: boolean) => void;
  status: ServerStatus | null; llm: boolean; live: boolean; pill: string;
  /** What Ledger and Freight are looking at: the chat session or a selected uploaded booking. */
  ctx: Ctx | null; setCtx: (c: Ctx | null) => void;
  /** A quick-launch pressed on the Overview page; the Telegraph consumes it once when it mounts. */
  requestLaunch: (k: LaunchKind) => void; takeLaunch: () => LaunchKind | null;
  store: MutableRefObject<Record<string, unknown>>; bump: () => void; version: number;
}

const Ctx_ = createContext<SessionValue | null>(null);

/**
 * One session for all pages. Next.js unmounts a page on navigation, so anything that must survive
 * (the chat log and conversation state, the uploaded batch, the selected booking) lives here, not in the page.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState("");
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const store = useRef<Record<string, unknown>>({});
  const launchRef = useRef<LaunchKind | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    setToday(localToday());
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ llm: false, label: "Offline parser (no API key)" }));
  }, []);

  const requestLaunch = useCallback((k: LaunchKind) => { launchRef.current = k; }, []);
  const takeLaunch = useCallback(() => { const k = launchRef.current; launchRef.current = null; return k; }, []);

  const llm = !!status?.llm;
  const live = llm && !offline;
  const pill = offline ? "Offline parser" : status ? (llm ? status.label : "Offline parser · no key") : "Checking…";

  const value = useMemo<SessionValue>(
    () => ({ today, setToday, offline, setOffline, status, llm, live, pill, ctx, setCtx, requestLaunch, takeLaunch, store, bump, version }),
    [today, offline, status, llm, live, pill, ctx, requestLaunch, takeLaunch, version],
  );
  // `version` changes whenever the store is written, so every consumer (e.g. the tracking header) re-renders.
  return <Ctx_.Provider value={value}>{children}</Ctx_.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx_);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}

/** useState that survives page changes. Same API as useState, including functional updates. */
export function useSessionState<T>(key: string, initial: T) {
  const { store, bump } = useSession();
  const init = useRef(initial);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const value = (key in store.current ? store.current[key] : init.current) as T;
  const set = useCallback((v: T | ((p: T) => T)) => {
    const prev = (key in store.current ? store.current[key] : init.current) as T;
    const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
    store.current[key] = next;
    force();
    bump();
  }, [key, store, bump]);
  return [value, set] as const;
}

/** useRef that survives page changes. */
export function useSessionRef<T>(key: string, initial: T): MutableRefObject<T> {
  const { store } = useSession();
  if (!(key in store.current)) store.current[key] = { current: initial };
  return store.current[key] as MutableRefObject<T>;
}

/** Read a session value from anywhere (e.g. the tracking header reads the chat phase). */
export function useSessionValue<T>(key: string, fallback: T): T {
  const { store } = useSession();
  return (key in store.current ? store.current[key] : fallback) as T;
}
