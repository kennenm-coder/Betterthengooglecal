// Checks for the measure tech's screen — the parts that DECIDE things, with no
// browser, no login and no database:
//   - which appointments belong to a tech (name matching)
//   - which bucket an appointment lands in (Today / This week / Later / Date
//     passed, still open / Not scheduled yet), and which are left off
//   - which roles get which view (and that nobody else's view changed)
//   - when a link is safe to draw
//
//   npm run check:measures
//
// Loads the .ts sources directly through node's own type stripping (Node 22.18+),
// which is why measure-appointments.ts imports nothing and roles.ts only has a
// type-only import. Fixtures are clearly fake: every name starts "ZZ DEMO".

import assert from "node:assert/strict";
import * as M from "../src/lib/measure-appointments.ts";
import * as R from "../src/lib/roles.ts";

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
}

// Wednesday 4 Nov 2026, mid-morning, local time.
const NOW = new Date(2026, 10, 4, 10, 30);

function appt(over = {}) {
  return M.toMeasureAppointment({
    id: "ZZ-WO-1",
    order_number: "ZZ-1001",
    work_order_number: "ZZ-WO-1",
    customer_name: "ZZ DEMO, Customer",
    address: "1 ZZ Demo Way, Nowhere, OH 43000",
    appointment_status: "Scheduled & Assigned",
    status: "",
    scheduled_start: "2026-11-04T08:00:00",
    tech_measure: "ZZ DEMO Tech",
    primary_resource: "",
    ...over,
  });
}
const groupOf = (over) => M.classifyMeasure(appt(over), NOW);

// ─── Name matching ───────────────────────────────────────────────────────────
check("name: exact match", () => assert.ok(M.isAssignedTo(appt(), "ZZ DEMO Tech")));
check("name: case and spacing folded", () => {
  assert.ok(M.isAssignedTo(appt({ tech_measure: "zz  demo   TECH " }), "  ZZ Demo Tech"));
});
check("name: accents and curly apostrophes folded", () => {
  assert.ok(M.isAssignedTo(appt({ tech_measure: "ZZ O’Démo" }), "zz o'demo"));
});
check("name: matches the booked resource when tech_measure is blank", () => {
  assert.ok(M.isAssignedTo(appt({ tech_measure: "", primary_resource: "ZZ DEMO Tech" }), "ZZ DEMO Tech"));
});
check("name: a different tech does not match", () => {
  assert.equal(M.isAssignedTo(appt({ tech_measure: "ZZ DEMO Other" }), "ZZ DEMO Tech"), false);
});
check("name: a first name or a surname alone does not match", () => {
  assert.equal(M.isAssignedTo(appt(), "ZZ"), false);
  assert.equal(M.isAssignedTo(appt(), "Tech"), false);
  assert.equal(M.isAssignedTo(appt({ tech_measure: "ZZ" }), "ZZ DEMO Tech"), false);
});
check("name: a blank login name matches NOTHING, even a row with no tech", () => {
  assert.equal(M.isAssignedTo(appt({ tech_measure: "", primary_resource: "" }), ""), false);
  assert.equal(M.isAssignedTo(appt(), "   "), false);
  assert.equal(M.isAssignedTo(appt(), undefined), false);
});
check("name: filterAssignedTo keeps only that tech's rows", () => {
  const rows = [appt({ id: "a" }), appt({ id: "b", tech_measure: "ZZ DEMO Other" }), appt({ id: "c", tech_measure: "", primary_resource: "zz demo tech" })];
  assert.deepEqual(M.filterAssignedTo(rows, "ZZ DEMO Tech").map((r) => r.id), ["a", "c"]);
});
check("name: database search token is the longest clean word", () => {
  assert.equal(M.nameSearchToken("Nate Sattler"), "sattler");
  assert.equal(M.nameSearchToken("Ryan Benoit-Perz"), "benoit-perz");
  assert.equal(M.nameSearchToken("  "), "");
  assert.equal(M.nameSearchToken(null), "");
  // Characters that would break a PostgREST filter are stripped, not passed through.
  assert.equal(M.nameSearchToken("Bad,(Name)%_"), "badname");
});

// ─── Status ──────────────────────────────────────────────────────────────────
check("status: every spelling of cancelled is cancelled", () => {
  for (const s of ["Cancelled", "Canceled", "CANCEL PENDING", "Appt Cancelled"]) {
    assert.ok(M.isCancelled(appt({ appointment_status: s })), s);
    assert.ok(M.isCancelled(appt({ appointment_status: "Scheduled & Assigned", status: s })), `status col: ${s}`);
  }
  assert.equal(M.isCancelled(appt()), false);
});
check("status: complete / closed is closed; scheduled is not", () => {
  assert.ok(M.isClosed(appt({ appointment_status: "Appt Complete / Closed" })));
  assert.equal(M.isClosed(appt({ appointment_status: "Scheduled & Assigned" })), false);
  assert.equal(M.isClosed(appt({ appointment_status: "To be Scheduled" })), false);
});

// ─── Dates ───────────────────────────────────────────────────────────────────
check("week: Sunday-to-Saturday, like the calendar", () => {
  assert.equal(M.weekEndKey(new Date(2026, 10, 4)), "2026-11-07"); // Wed
  assert.equal(M.weekEndKey(new Date(2026, 10, 1)), "2026-11-07"); // Sun
  assert.equal(M.weekEndKey(new Date(2026, 10, 7)), "2026-11-07"); // Sat is its own week end
});
check("week: crosses month and year ends", () => {
  assert.equal(M.weekEndKey(new Date(2026, 9, 30)), "2026-10-31");
  assert.equal(M.weekEndKey(new Date(2026, 11, 30)), "2027-01-02");
});
check("lookback start is midnight, 90 days back, in the calendar's timestamp shape", () => {
  assert.equal(M.MEASURE_LOOKBACK_DAYS, 90);
  assert.equal(M.measureLookbackStart(NOW), "2026-08-06T00:00:00");
});
check("daysAgo counts calendar days and survives a DST change", () => {
  assert.equal(M.daysAgo({ scheduledStart: "2026-11-04T08:00:00" }, NOW), 0);
  assert.equal(M.daysAgo({ scheduledStart: "2026-11-03T23:59:00" }, NOW), 1);
  assert.equal(M.daysAgo({ scheduledStart: "2026-10-28T08:00:00" }, NOW), 7); // clocks went back 1 Nov
  assert.equal(M.daysAgo({ scheduledStart: "2026-11-06T08:00:00" }, NOW), -2);
  assert.equal(M.daysAgo({ scheduledStart: null }, NOW), null);
});
check("rows: the UTC suffix is dropped and blanks are tolerated", () => {
  assert.equal(appt({ scheduled_start: "2026-11-04T08:00:00+00:00" }).scheduledStart, "2026-11-04T08:00:00");
  assert.equal(appt({ scheduled_start: "2026-11-04T08:00:00.000Z" }).scheduledStart, "2026-11-04T08:00:00.000");
  assert.equal(appt({ scheduled_start: null }).scheduledStart, null);
  const bare = M.toMeasureAppointment({});
  assert.equal(bare.customerName, "");
  assert.equal(bare.scheduledStart, null);
});
check("rows: customer name falls back the way TrimGauge's does", () => {
  assert.equal(appt({ customer_name: "", contact_name: "ZZ DEMO, Contact" }).customerName, "ZZ DEMO, Contact");
  assert.equal(appt({ customer_name: "", contact_name: "", account_name: "ZZ DEMO Acct" }).customerName, "ZZ DEMO Acct");
});

// ─── Grouping ────────────────────────────────────────────────────────────────
check("group: today", () => assert.equal(groupOf({}), "today"));
check("group: later today is still today", () => assert.equal(groupOf({ scheduled_start: "2026-11-04T17:30:00" }), "today"));
check("group: an already-closed measure today stays on today's list", () => {
  assert.equal(groupOf({ appointment_status: "Appt Complete / Closed" }), "today");
});
check("group: tomorrow through Saturday is this week", () => {
  assert.equal(groupOf({ scheduled_start: "2026-11-05T08:00:00" }), "week");
  assert.equal(groupOf({ scheduled_start: "2026-11-07T16:00:00" }), "week");
});
check("group: Sunday onward is later", () => {
  assert.equal(groupOf({ scheduled_start: "2026-11-08T08:00:00" }), "later");
  assert.equal(groupOf({ scheduled_start: "2027-02-01T08:00:00" }), "later");
});
check("group: an earlier day still open is date-passed", () => {
  assert.equal(groupOf({ scheduled_start: "2026-11-03T08:00:00" }), "overdue");
  assert.equal(groupOf({ scheduled_start: "2026-10-01T08:00:00", appointment_status: "To be Scheduled" }), "overdue");
});
check("group: an earlier day that was closed is not listed", () => {
  assert.equal(groupOf({ scheduled_start: "2026-11-03T08:00:00", appointment_status: "Appt Complete / Closed" }), null);
});
check("group: no date, still open, is 'not scheduled yet'; no date and closed is not listed", () => {
  assert.equal(groupOf({ scheduled_start: null, appointment_status: "To be Scheduled" }), "unscheduled");
  assert.equal(groupOf({ scheduled_start: null, appointment_status: "Appt Complete / Closed" }), null);
});
check("group: cancelled is never listed, whatever the day", () => {
  for (const day of ["2026-11-03", "2026-11-04", "2026-11-06", "2026-12-01"]) {
    assert.equal(groupOf({ scheduled_start: `${day}T08:00:00`, appointment_status: "Cancelled" }), null, day);
  }
  assert.equal(groupOf({ scheduled_start: null, appointment_status: "Canceled" }), null);
});
check("group: midnight edges stay on their own day", () => {
  assert.equal(M.classifyMeasure(appt({ scheduled_start: "2026-11-04T00:00:00" }), new Date(2026, 10, 4, 23, 59)), "today");
  assert.equal(M.classifyMeasure(appt({ scheduled_start: "2026-11-04T23:59:00" }), new Date(2026, 10, 5, 0, 1)), "overdue");
});
check("group: on a Saturday the week is empty and Sunday is later", () => {
  const sat = new Date(2026, 10, 7, 9, 0);
  assert.equal(M.classifyMeasure(appt({ scheduled_start: "2026-11-08T08:00:00" }), sat), "later");
});
check("groups: order, labels, sorting, empty groups left out", () => {
  const rows = [
    appt({ id: "later", scheduled_start: "2026-12-01T08:00:00" }),
    appt({ id: "overdue", scheduled_start: "2026-11-02T08:00:00" }),
    appt({ id: "week2", scheduled_start: "2026-11-06T13:00:00" }),
    appt({ id: "week1", scheduled_start: "2026-11-05T08:00:00" }),
    appt({ id: "today", scheduled_start: "2026-11-04T09:00:00" }),
    appt({ id: "none", scheduled_start: null, appointment_status: "To be Scheduled" }),
    appt({ id: "cancelled", scheduled_start: "2026-11-05T09:00:00", appointment_status: "Cancelled" }),
  ];
  const groups = M.groupMeasureAppointments(rows, NOW);
  assert.deepEqual(groups.map((g) => g.key), ["today", "week", "later", "overdue", "unscheduled"]);
  assert.deepEqual(groups.map((g) => g.label), ["Today", "This week", "Later", "Date passed, still open", "Not scheduled yet"]);
  assert.deepEqual(groups.find((g) => g.key === "week").items.map((i) => i.id), ["week1", "week2"]);
  assert.ok(!groups.some((g) => g.items.some((i) => i.id === "cancelled")));
  assert.deepEqual(M.groupMeasureAppointments([], NOW), []);
  assert.deepEqual(M.groupMeasureAppointments([rows[0]], NOW).map((g) => g.key), ["later"]);
});
check("pipeline: only the signed-in tech's rows reach the screen", () => {
  const rows = [
    { id: "r1", order_number: "ZZ-1", customer_name: "ZZ DEMO, A", appointment_status: "Scheduled & Assigned", scheduled_start: "2026-11-04T08:00:00Z", tech_measure: "ZZ DEMO Tech" },
    { id: "r2", order_number: "ZZ-2", customer_name: "ZZ DEMO, B", appointment_status: "Scheduled & Assigned", scheduled_start: "2026-11-04T09:00:00Z", tech_measure: "ZZ DEMO Other" },
    { id: "r3", order_number: "ZZ-3", customer_name: "ZZ DEMO, C", appointment_status: "Scheduled & Assigned", scheduled_start: "2026-11-05T09:00:00Z", tech_measure: "", primary_resource: "zz demo tech" },
    { id: "r4", order_number: "ZZ-4", customer_name: "ZZ DEMO, D", appointment_status: "To be Scheduled", scheduled_start: null, tech_measure: "" },
  ];
  const mine = M.groupMeasureAppointments(M.filterAssignedTo(rows.map(M.toMeasureAppointment), "ZZ DEMO Tech"), NOW);
  assert.deepEqual(mine.map((g) => [g.key, g.items.map((i) => i.id)]), [["today", ["r1"]], ["week", ["r3"]]]);
  const none = M.groupMeasureAppointments(M.filterAssignedTo(rows.map(M.toMeasureAppointment), ""), NOW);
  assert.deepEqual(none, []);
});

// ─── Roles: who sees which view ──────────────────────────────────────────────
check("roles: scope matrix", () => {
  const cases = [
    [["measure-tech"], "mine"],
    [["measure-tech", "member"], "mine"],
    [["measure-tech", "payroll-admin"], "mine"],
    [["measure-tech", "sales"], "mine"],
    [["measure-tech", "admin"], "all"],
    [["measure-tech", "scheduling"], "all"],
    [["measure-tech", "scheduling_manager"], "all"],
    [["measure-tech", "field-manager"], "all"],
    [["admin"], "all"],
    [["member"], "none"],
    [["field-manager"], "none"],
    [["scheduling"], "none"],
    [[], "none"],
    [["installer"], "none"],
    [["installer", "measure-tech"], "none"],
    [["installer", "measure-tech", "admin"], "all"], // admin is the one exemption, as with isInstaller
  ];
  for (const [roles, want] of cases) assert.equal(R.measureScope(roles), want, JSON.stringify(roles));
  assert.equal(R.measureScope("measure-tech"), "mine");
  assert.equal(R.measureScope(null), "none");
  assert.equal(R.measureScope(undefined), "none");
});
check("roles: only the measure-tech role grows a nav tab", () => {
  assert.equal(R.isMeasureTech(["measure-tech"]), true);
  assert.equal(R.isMeasureTech(["admin"]), false); // an admin's nav is unchanged until they tick the role
  assert.equal(R.isMeasureTech(["member"]), false);
  assert.equal(R.isMeasureTech(["installer", "measure-tech"]), false);
  assert.equal(R.isMeasureTech([]), false);
});
check("roles: only a measure tech with nothing broader lands on Measures", () => {
  assert.equal(R.landsOnMeasures(["measure-tech"]), true);
  assert.equal(R.landsOnMeasures(["measure-tech", "member"]), true);
  assert.equal(R.landsOnMeasures(["measure-tech", "admin"]), false);
  assert.equal(R.landsOnMeasures(["measure-tech", "scheduling"]), false);
  assert.equal(R.landsOnMeasures(["admin"]), false);
  assert.equal(R.landsOnMeasures(["member"]), false);
  assert.equal(R.landsOnMeasures([]), false);
});
check("roles: canSeeMeasureAppointments follows the scope", () => {
  assert.equal(R.canSeeMeasureAppointments(["measure-tech"]), true);
  assert.equal(R.canSeeMeasureAppointments(["admin"]), true);
  assert.equal(R.canSeeMeasureAppointments(["member"]), false);
  assert.equal(R.canSeeMeasureAppointments(["installer"]), false);
});
check("roles: holding measure-tech grants none of the existing capabilities", () => {
  const roles = ["measure-tech"];
  assert.equal(R.isAdmin(roles), false);
  assert.equal(R.isInstaller(roles), false);
  assert.equal(R.canDoFieldWork(roles), false);
  assert.equal(R.canSeeFloaters(roles), false);
  assert.equal(R.canReviewWriteUps(roles), false);
  assert.equal(R.canSeeWriteUps(roles), false);
  assert.equal(R.canApproveTimeOff(roles), false);
  assert.equal(R.canManageTimeOff(roles), false);
  assert.equal(R.canEditLegacyLink(roles), false);
});
check("roles: the see-all list is the one the docs say", () => {
  assert.deepEqual([...R.MEASURE_SEE_ALL_ROLES].sort(), ["admin", "field-manager", "scheduling", "scheduling_manager"]);
});

// ─── Links ───────────────────────────────────────────────────────────────────
check("maps link: encodes the address; blank has no link", () => {
  assert.equal(
    M.mapsUrl("1 ZZ Demo Way, Nowhere, OH 43000"),
    "https://www.google.com/maps/search/?api=1&query=1%20ZZ%20Demo%20Way%2C%20Nowhere%2C%20OH%2043000"
  );
  assert.equal(M.mapsUrl("   "), null);
  assert.equal(M.mapsUrl(""), null);
});
check("Measure Tools link: only an absolute web address, else hidden", () => {
  assert.equal(M.measureToolsUrl(undefined), null);
  assert.equal(M.measureToolsUrl(null), null);
  assert.equal(M.measureToolsUrl(""), null);
  assert.equal(M.measureToolsUrl("   "), null);
  assert.equal(M.measureToolsUrl("not a url"), null);
  assert.equal(M.measureToolsUrl("trim-gauge.example.test"), null);
  assert.equal(M.measureToolsUrl("javascript:alert(1)"), null);
  assert.equal(M.measureToolsUrl("ftp://example.test"), null);
  assert.equal(M.measureToolsUrl("https://measure.example.test"), "https://measure.example.test/");
  assert.equal(M.measureToolsUrl("  http://localhost:3001/  "), "http://localhost:3001/");
});
check("Measure Tools link: defaults to NEXT_PUBLIC_TRIMGAUGE_URL, hidden when it is unset", () => {
  const saved = process.env.NEXT_PUBLIC_TRIMGAUGE_URL;
  try {
    delete process.env.NEXT_PUBLIC_TRIMGAUGE_URL;
    assert.equal(M.measureToolsUrl(), null);
    process.env.NEXT_PUBLIC_TRIMGAUGE_URL = "https://measure.example.test";
    assert.equal(M.measureToolsUrl(), "https://measure.example.test/");
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_TRIMGAUGE_URL;
    else process.env.NEXT_PUBLIC_TRIMGAUGE_URL = saved;
  }
});

if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED, ${passed} passed:\n`);
  for (const f of failures) console.error(`  x ${f}\n`);
  process.exit(1);
}
console.log(`measure-appointments: ${passed} checks passed.`);
