// Is this device's connection good enough to refresh on its own — and is a
// newer version of the app deployed?
//
// One tiny request to our own /api/version answers both. The phone's
// navigator.onLine is NOT enough: it reads true with one bar of signal in a
// dead zone, which is exactly where an automatic refresh must never fire. A
// real round trip that comes back fast is the only honest proof.
//
// The service worker never caches /api/ (see public/sw.js), and the route is
// skipped by the middleware, so the answer is always the live server's, and
// quick.

/** The commit this bundle was built from ("" on a local build). See next.config.ts. */
export const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

/** Slower than this counts as "not reliable" — a refresh would crawl or fail. */
const PROBE_TIMEOUT_MS = 4_000;
/** Re-use an answer this fresh rather than asking again. */
const PROBE_REUSE_MS = 30_000;

export type ConnectionCheck = {
  /** The server answered, fast. */
  good: boolean;
  /** The server is running a different build than this page. */
  newVersion: boolean;
};

let last: { at: number; result: ConnectionCheck } | null = null;
let inFlight: Promise<ConnectionCheck> | null = null;
let newVersionSeen = false;

/**
 * Android Chrome can tell us the network is very slow or the user asked to
 * save data. iPhones don't report this, so the round trip below is still the
 * main test; this just saves a request on a phone that's plainly crawling.
 */
function connectionLooksPoor(): boolean {
  const c = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  }).connection;
  if (!c) return false;
  if (c.saveData) return true;
  return c.effectiveType === "slow-2g" || c.effectiveType === "2g";
}

const BAD: ConnectionCheck = { good: false, newVersion: false };

async function probe(): Promise<ConnectionCheck> {
  if (typeof window === "undefined") return BAD;
  // Plainly offline: make no request at all.
  if (!navigator.onLine || connectionLooksPoor()) return BAD;

  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch("/api/version", { cache: "no-store", signal: ac.signal });
    if (!res.ok) return BAD;
    const body = (await res.json()) as { build?: unknown };
    const serverBuild = typeof body.build === "string" ? body.build : "";
    return {
      good: true,
      // Only call it a new version when BOTH sides know their build — a local
      // build or a missing value must never trigger a reload.
      newVersion: !!CLIENT_BUILD_ID && !!serverBuild && serverBuild !== CLIENT_BUILD_ID,
    };
  } catch {
    // Timed out, dropped, or no route to the server: not reliable.
    return BAD;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Check the connection (and the deployed version). Shares one request between
 * callers and re-uses a recent good answer. A bad answer is not re-used, so the
 * moment signal comes back the next check can see it.
 */
export function checkConnection(opts: { fresh?: boolean } = {}): Promise<ConnectionCheck> {
  const now = Date.now();
  if (!opts.fresh && last && last.result.good && now - last.at < PROBE_REUSE_MS) {
    return Promise.resolve(last.result);
  }
  if (inFlight) return inFlight;
  inFlight = probe().then((result) => {
    last = { at: Date.now(), result };
    if (result.newVersion) newVersionSeen = true;
    inFlight = null;
    return result;
  });
  return inFlight;
}

/** A newer build has been seen on the server at some point this session. */
export function newVersionKnown(): boolean {
  return newVersionSeen;
}
