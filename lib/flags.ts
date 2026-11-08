/**
 * Gate for demo seed data. `SEED_DEMO_DATA=false` (or 0/off/no) disables it so a
 * production deployment starts with an empty hub.
 */
export function seedDemoDataEnabled(): boolean {
  const raw = process.env.SEED_DEMO_DATA;
  if (raw === undefined || raw.trim() === "") return true;
  return !["false", "0", "off", "no"].includes(raw.trim().toLowerCase());
}

/** Set SEED_DEMO_DATA=false in production if you want an empty hub. */
export const DEMO_PASSWORD = "demo1234";
