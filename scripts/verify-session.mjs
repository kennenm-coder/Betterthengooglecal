// Reproduces the write-up RLS failure and verifies the fix, with no real login
// and no network. It checks WHICH auth token each Supabase client attaches to a
// PostgREST write:
//   • login client (createBrowserClient) establishes a session in cookie storage
//   • NEW data client (createBrowserClient, the fixed getSupabase) must reuse it
//   • OLD data client (plain createClient, localStorage) does NOT see it → anon
// An anonymous write is exactly what got rejected by RLS (get_user_role() null).

// ── 1. Browser-ish globals BEFORE importing the libs ──
const jar = new Map();
globalThis.window = globalThis;
globalThis.document = {
  get cookie() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  },
  set cookie(str) {
    const [pair] = str.split(";");
    const i = pair.indexOf("=");
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (v === "" || /expires=Thu, 01 Jan 1970/i.test(str)) jar.delete(k);
    else jar.set(k, v);
  },
};
const lsMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => lsMap.set(k, String(v)),
  removeItem: (k) => lsMap.delete(k),
};

// ── 2. Capture the Authorization header of PostgREST calls; no real network ──
let captured = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const h = new Headers(opts.headers || {});
  if (u.includes("/rest/v1/")) captured = h.get("Authorization");
  return new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const { createBrowserClient } = await import("@supabase/ssr");
const { createClient } = await import("@supabase/supabase-js");

const URL = "https://demo.supabase.co";
const ANON = "anon-key-abc";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const USER_JWT =
  `${b64({ alg: "HS256", typ: "JWT" })}.` +
  `${b64({ sub: "u1", role: "authenticated", email: "admin@test.dev", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const authOpts = {
  auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
};

// ── 3. Simulate login: session lands in the shared cookie jar ──
const loginClient = createBrowserClient(URL, ANON, authOpts);
await loginClient.auth.setSession({ access_token: USER_JWT, refresh_token: "r1" });
console.log("Cookie jar after login has session:", jar.size > 0);

// ── 4. NEW client (fixed getSupabase) — should reuse the cookie session ──
captured = null;
const newClient = createBrowserClient(URL, ANON, authOpts);
await newClient.from("field_work_orders").insert({ order_number: "TEST" });
const newAuth = captured;

// ── 5. OLD client (plain createClient, localStorage) — cannot see the session ──
captured = null;
const oldClient = createClient(URL, ANON, authOpts);
await oldClient.from("field_work_orders").insert({ order_number: "TEST" });
const oldAuth = captured;

// ── 6. Verdict ──
const sendsUserJwt = (v) => v === `Bearer ${USER_JWT}`;
console.log("\n--- Authorization header sent on the write-up INSERT ---");
console.log("NEW getSupabase (fixed):", newAuth === `Bearer ${USER_JWT}` ? "Bearer <USER JWT> ✅" : newAuth);
console.log("OLD plain client:       ", oldAuth === `Bearer ${ANON}` ? "Bearer <anon key> (anonymous) ❌" : oldAuth);

const pass = sendsUserJwt(newAuth) && !sendsUserJwt(oldAuth);
console.log("\nRESULT:", pass ? "PASS — fixed client authenticates, old one was anonymous" : "FAIL");
process.exit(pass ? 0 : 1);
