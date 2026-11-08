import type { Metadata } from "next";

import { ensureBootSync } from "../lib/boot.ts";
import "./globals.css";

// Reconcile repo-side handover documents once per server process.
ensureBootSync();

export const metadata: Metadata = {
  title: "Future Enhancements Hub",
  description:
    "Multi-tenant, plug-and-play enhancement intake with local AI-assisted drafting, a Markdown vault and GitHub handover publishing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
