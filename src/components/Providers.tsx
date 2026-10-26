"use client";
import type { ReactNode } from "react";
import { SessionProvider } from "./SessionProvider";
import Shell from "./Shell";

export default function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider><Shell>{children}</Shell></SessionProvider>;
}
