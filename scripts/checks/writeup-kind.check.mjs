// Pins down the write-up JIP / Service rule (src/lib/writeup-kind.ts) and the
// stamper that stores it (src/lib/writeup-kind-stamp.ts). Run with:
//
//     node scripts/checks/writeup-kind.check.mjs
//
// No database: the stamper runs against a small in-memory stand-in for the
// Supabase client. Every job here is made up.

import { register } from "node:module";
// Node prints a notice for every .ts file it re-reads as ESM; not news here.
process.removeAllListeners("warning");
register("./ts-resolver.mjs", import.meta.url);

const { decideWriteUpKinds, installOf, jobClosedAt, daysBetween, writeUpKindReason, JIP_WINDOW_DAYS } = await import(
  "../../src/lib/writeup-kind.ts"
);
const { stampWriteUpKinds } = await import("../../src/lib/writeup-kind-stamp.ts");

let fails = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  ok  " + name);
  else {
    fails++;
    console.log("FAIL  " + name + (extra ? "  " + JSON.stringify(extra) : ""));
  }
};

// Noon Ohio time on a day, as the database would hand it back.
const at = (ymd, hourUtc = 16) => `${ymd}T${String(hourUtc).padStart(2, "0")}:00:00+00:00`;
const install = (ymd, status = "Install Complete", extra = {}) => ({
  order_number: "ZZ1",
  status,
  work_order_type: "Install",
  scheduled_start: ymd ? at(ymd, 13) : null,
  updated_at: at("2026-11-12"),
  ...extra,
});
let n = 0;
const wu = (ymd, extra = {}) => ({
  id: `w${++n}`,
  batch_id: null,
  created_at: at(ymd),
  status: "open",
  job_closed_since: null,
  auto_closed_at: null,
  ...extra,
});
const decide = (ownRows, writeUps, cutoff = null) => {
  const m = decideWriteUpKinds({ ownRows, writeUps, cutoff });
  return writeUps.map((w) => {
    const d = m.get(w.batch_id || `row:${w.id}`);
    return d === undefined ? "-" : d === null ? null : d.kind;
  });
};

console.log("1. The first write-up against the install date");
ok("window is 30 days", JIP_WINDOW_DAYS === 30);
ok("10 days after install: JIP", decide([install("2026-09-01")], [wu("2026-09-11")])[0] === "jip");
ok("exactly 30 days after: still JIP", decide([install("2026-09-01")], [wu("2026-10-01")])[0] === "jip");
ok("31 days after: Service", decide([install("2026-09-01")], [wu("2026-10-02")])[0] === "service");
ok("written up before the install: JIP", decide([install("2026-09-01", "Install Scheduled")], [wu("2026-08-20")])[0] === "jip");
{
  const r = decide([install("2026-09-01")], [wu("2026-10-20"), wu("2026-09-15")]);
  ok("first is judged by date, not list order: the Sept 15 one makes the job JIP", r[0] === "jip" && r[1] === "jip", r);
}
{
  const r = decide([install("2026-06-01")], [wu("2026-08-01"), wu("2026-08-02"), wu("2027-01-05")]);
  ok("first after the window: it and every later one are Service", r.every((k) => k === "service"), r);
}
{
  // Ohio day, not UTC: 02:00 UTC on Oct 2 is the evening of Oct 1 in Ohio.
  const r = decide([install("2026-09-01")], [{ ...wu("2026-10-02"), created_at: "2026-10-02T02:00:00+00:00" }]);
  ok("days are counted in Ohio time (Oct 1 evening = day 30)", r[0] === "jip", r);
}

console.log("\n2. The install date");
ok("a two-day install counts from its last day", installOf([install("2026-09-01"), install("2026-09-02")]).day === "2026-09-02");
ok(
  "day 31 after day one but day 30 after day two: JIP",
  decide([install("2026-09-01"), install("2026-09-02")], [wu("2026-10-02")])[0] === "jip"
);
ok("no Install order on file: no answer", decide([{ ...install("2026-09-01"), work_order_type: "Service", status: "Service Complete" }], [wu("2026-09-05")])[0] === null);
ok("no work orders at all: no answer", decide([], [wu("2026-09-05")])[0] === null);
ok("an oddly typed order still read by its Install status", installOf([{ ...install("2026-09-01"), work_order_type: "" }]).day === "2026-09-01");
ok("Install order not dated and not done: before the install (JIP)", decide([install(null, "Install Needed")], [wu("2026-09-05")])[0] === "jip");
ok("Install order marked complete with no date: no answer, not a guess", decide([install(null, "Install Complete")], [wu("2026-09-05")])[0] === null);

console.log("\n3. JIP until the job reaches closed");
{
  const rows = [wu("2026-09-10"), wu("2026-10-01", { job_closed_since: at("2026-10-20") }), wu("2026-10-25")];
  const r = decide([install("2026-09-01")], rows);
  ok("Job Closed clock on one write-up: earlier ones JIP, a later one Service", r.join() === "jip,jip,service", r);
}
{
  // Auto-closed on Oct 27 = the clock started Oct 20.
  const rows = [wu("2026-09-10", { status: "closed", auto_closed_at: at("2026-10-27") }), wu("2026-10-21"), wu("2026-10-19")];
  const r = decide([install("2026-09-01")], rows);
  ok("auto-closed: closed from AUTO_CLOSE_DAYS before the close", r.join() === "jip,service,jip", r);
  ok("jobClosedAt from auto_closed_at", jobClosedAt([], rows, null).startsWith("2026-10-20"));
}
{
  // Every write-up closed by hand, then rForce closed the job: only the
  // order dropping off the report says so.
  const own = [install("2026-09-01", "Install Complete", { updated_at: at("2026-10-15") })];
  const rows = [wu("2026-09-10", { status: "closed" }), wu("2026-11-01")];
  const cutoff = at("2026-11-10");
  const r = decide(own, rows, cutoff);
  ok("install order off the report: Service after its last import", r.join() === "jip,service", r);
  ok("without a cutoff the report is not judged", decide(own, rows, null).join() === "jip,jip");
  const still = [install("2026-09-01", "Install Complete", { updated_at: at("2026-11-11") })];
  ok("an order still on the report is open", decide(still, rows, cutoff).join() === "jip,jip");
}
{
  const r = decide([install("2026-09-01")], [wu("2026-09-10", { job_closed_since: at("2026-09-05") })]);
  ok("a first write-up made after the job closed is Service", r[0] === "service", r);
}

console.log("\n4. Submissions, drafts");
{
  const rows = [
    wu("2026-10-05", { batch_id: "b1" }),
    wu("2026-09-20", { batch_id: "b1" }),
    wu("2026-10-10", { batch_id: "b2" }),
  ];
  const r = decide([install("2026-09-01")], rows);
  ok("every unit row of one submission gets one answer", r[0] === r[1], r);
  const m = decideWriteUpKinds({ ownRows: [install("2026-09-01")], writeUps: rows, cutoff: null });
  ok("a submission is dated by its earliest row", m.get("b1").detail.firstWriteUpDay === "2026-09-20", m.get("b1"));
}
{
  const rows = [wu("2026-09-05", { status: "draft" }), wu("2026-10-20")];
  const r = decide([install("2026-09-01")], rows);
  ok("a draft gets no answer and is not 'the first'", r[0] === "-" && r[1] === "service", r);
}
ok("an archived write-up still counts as the first", decide([install("2026-09-01")], [wu("2026-09-05", { status: "archived" }), wu("2026-10-20")]).join() === "jip,jip");

console.log("\n5. Why");
{
  const m = decideWriteUpKinds({ ownRows: [install("2026-06-01")], writeUps: [wu("2026-08-01")], cutoff: null });
  const d = [...m.values()][0];
  ok("detail carries the install, the first write-up and the gap", d.detail.installDay === "2026-06-01" && d.detail.daysAfterInstall === 61, d);
  ok("reason says it in words", /61 days after the install \(more than 30\)/.test(writeUpKindReason(d.kind, d.detail)), writeUpKindReason(d.kind, d.detail));
}
ok("daysBetween across a month", daysBetween("2026-09-01", "2026-10-01") === 30);

// ── The stamper, against an in-memory Supabase ─────────────────────────────
console.log("\n6. Stamping");
function fakeSupabase(tables) {
  const updates = [];
  function query(table) {
    const filters = [];
    let patch = null;
    let range = null;
    let limit = null;
    const q = {
      select() { return q; },
      update(p) { patch = p; return q; },
      is(col, v) { filters.push((r) => (r[col] ?? null) === v); return q; },
      eq(col, v) { filters.push((r) => r[col] === v); return q; },
      neq(col, v) { filters.push((r) => r[col] !== v); return q; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return q; },
      order() { return q; },
      range(a, b) { range = [a, b]; return q; },
      limit(k) { limit = k; return q; },
      then(resolve, reject) {
        try {
          let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          if (patch) {
            rows.forEach((r) => Object.assign(r, patch));
            updates.push({ table, ids: rows.map((r) => r.id), patch });
            return resolve({ data: null, error: null });
          }
          if (range) rows = rows.slice(range[0], range[1] + 1);
          if (limit != null) rows = rows.slice(0, limit);
          return resolve({ data: rows.map((r) => ({ ...r })), error: null });
        } catch (e) {
          return reject(e);
        }
      },
    };
    return q;
  }
  return { from: query, updates };
}
{
  const tables = {
    rforce_import_runs: [],
    work_orders: [
      { id: 1, ...install("2026-09-01"), order_number: "ZZ DEMO 1" },
      { id: 2, ...install("2026-03-01"), order_number: "ZZ DEMO 2" },
      { id: 3, order_number: "ZZ DEMO 3", status: "New", work_order_type: "Service", scheduled_start: null, updated_at: at("2026-11-12") },
    ],
    field_work_orders: [
      { ...wu("2026-09-10", { batch_id: "a" }), order_number: "ZZ DEMO 1", writeup_kind: null },
      { ...wu("2026-09-10", { batch_id: "a" }), order_number: "ZZ DEMO 1", writeup_kind: null },
      // Already answered — must never change, even though the rule would now say JIP.
      { ...wu("2026-09-12"), order_number: "ZZ DEMO 1", writeup_kind: "service", writeup_kind_detail: { rule: "after_job_closed" } },
      { ...wu("2026-09-20", { status: "draft" }), order_number: "ZZ DEMO 1", writeup_kind: null },
      { ...wu("2026-09-20"), order_number: "ZZ DEMO 2", writeup_kind: null },
      { ...wu("2026-09-20"), order_number: "ZZ DEMO 3", writeup_kind: null },
    ],
  };
  const sb = fakeSupabase(tables);
  const sum = await stampWriteUpKinds(sb);
  const fwo = tables.field_work_orders;
  ok("both unit rows of a JIP submission stamped JIP", fwo[0].writeup_kind === "jip" && fwo[1].writeup_kind === "jip", fwo.slice(0, 2));
  ok("an answer already stored is never changed", fwo[2].writeup_kind === "service");
  ok("a draft is left alone", fwo[3].writeup_kind === null);
  ok("first write-up 203 days after the install: Service", fwo[4].writeup_kind === "service" && fwo[4].writeup_kind_detail.daysAfterInstall === 203, fwo[4]);
  ok("no install on file: left blank for the next import", fwo[5].writeup_kind === null);
  ok("summary counts", sum.stamped === 3 && sum.unknown === 1 && sum.orders === 3, sum);
  ok("the stamp time is written", !!fwo[0].writeup_kind_at);

  const again = await stampWriteUpKinds(sb);
  ok("a second run writes nothing new", again.stamped === 0, again);

  const one = fakeSupabase(JSON.parse(JSON.stringify({ ...tables, field_work_orders: tables.field_work_orders.map((r) => ({ ...r, writeup_kind: null })) })));
  await stampWriteUpKinds(one, { orderNumbers: ["ZZ DEMO 2"] });
  ok("a submit-time stamp touches only its own job", one.updates.every((u) => u.ids.length === 1), one.updates);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
