"use client";

// DEV-ONLY harness for the Warehouse Links screen. Renders nothing in
// production (NODE_ENV is "production" on Vercel), and the middleware only
// exempts /dev-* from auth in development — so this is inert and unreachable
// in production.
//
// No Supabase, no Orca. The factory jobs, the warehouse rows and the work
// orders behind the suggestions are all made up, and linking only moves local
// state. It exists to answer "what will this look like" before migration 039
// has put anything in the mirror.

import { useState } from "react";
import OrcaLinksView from "@/components/OrcaLinksView";
import {
  MatchCounts,
  OrcaLink,
  UnmatchedGroup,
  suggestOrders,
} from "@/lib/orca-links";

// Orca's factory rows put the customer in the Name column as
// "Surname,Firstname" — that is the only clue to whose job it is.
const SAMPLE_GROUPS: UnmatchedGroup[] = [
  {
    jobOrderNumber: "8124444",
    rowCount: 14,
    samples: [
      "DH 24 1/2 x 48 White/Pine Stain",
      "CAS 30 x 60 White/White",
      "PTD 72 x 80 White/Pine",
    ],
    names: ["Abbott,Kelly"],
  },
  {
    jobOrderNumber: "8124501",
    rowCount: 9,
    samples: ["PIC 48 x 36 White/White", "Hardware pack — sash locks"],
    names: ["Johnson,Mark"],
  },
  {
    jobOrderNumber: "8124588",
    rowCount: 6,
    samples: ["AWN 36 x 24 White/White"],
    names: ["Delgado,Rosa"],
  },
  {
    // The awkward one: no usable name, so no suggestion is offered and the
    // office has to go and look it up. Worth seeing on the screen.
    jobOrderNumber: "8124610",
    rowCount: 3,
    samples: ["SPW 22 x 22 White/White"],
    names: ["-,04794151/097"],
  },
];

const SAMPLE_LINKS: OrcaLink[] = [
  {
    jobOrderNumber: "8124300",
    orderNumber: "04717321",
    source: "manual",
    createdAt: "2026-10-18T15:04:00Z",
    rowCount: 11,
  },
  {
    jobOrderNumber: "8124355",
    orderNumber: "04717402",
    source: "rforce",
    createdAt: "2026-10-17T09:12:00Z",
    rowCount: 7,
  },
];

const SAMPLE_ORDERS = [
  { orderNumber: "04717511", customerName: "Kelly Abbott" },
  { orderNumber: "04717524", customerName: "Mark Johnson" },
  { orderNumber: "04717530", customerName: "Dana Johnson" },
  { orderNumber: "04717545", customerName: "Rosa Delgado" },
  { orderNumber: "04717560", customerName: "Pete Ramirez" },
];

const SAMPLE_COUNTS: MatchCounts = { matched: 381, unmatched: 1321 };

export default function DevOrcaLinksPage() {
  const [groups, setGroups] = useState(SAMPLE_GROUPS);
  const [links, setLinks] = useState(SAMPLE_LINKS);
  const [counts, setCounts] = useState(SAMPLE_COUNTS);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null
  );

  function save(job: string, order: string) {
    setBusyJob(job);
    setMessage(null);
    // Fake the round trip so the spinner is visible.
    setTimeout(() => {
      const g = groups.find((x) => x.jobOrderNumber === job);
      const moved = g?.rowCount ?? 0;
      setGroups((gs) => gs.filter((x) => x.jobOrderNumber !== job));
      setLinks((ls) => [
        {
          jobOrderNumber: job,
          orderNumber: order,
          source: "manual",
          createdAt: new Date().toISOString(),
          rowCount: moved,
        },
        ...ls,
      ]);
      setCounts((c) => ({
        matched: c.matched + moved,
        unmatched: Math.max(0, c.unmatched - moved),
      }));
      setMessage({
        kind: "ok",
        text: `Linked ${job} to ${order} — that placed ${moved} ${
          moved === 1 ? "row" : "rows"
        }.`,
      });
      setBusyJob(null);
    }, 400);
  }

  function remove(job: string) {
    setBusyJob(job);
    setMessage(null);
    setTimeout(() => {
      const l = links.find((x) => x.jobOrderNumber === job);
      const moved = l?.rowCount ?? 0;
      setLinks((ls) => ls.filter((x) => x.jobOrderNumber !== job));
      // Put the group back as it was. The real screen reloads from the
      // database here; the harness has to remember it, or a removed link
      // comes back as a bare job number with no descriptions and looks like
      // a bug in the screen rather than in the sample data.
      const original = SAMPLE_GROUPS.find((x) => x.jobOrderNumber === job);
      setGroups((gs) => [
        ...gs,
        original ?? { jobOrderNumber: job, rowCount: moved, samples: [], names: [] },
      ]);
      setCounts((c) => ({
        matched: Math.max(0, c.matched - moved),
        unmatched: c.unmatched + moved,
      }));
      setMessage({
        kind: "ok",
        text: `Removed the link for ${job} — ${moved} ${
          moved === 1 ? "row went" : "rows went"
        } back to unmatched.`,
      });
      setBusyJob(null);
    }, 400);
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="p-4 pb-0">
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
          <strong>Dev harness.</strong> Made-up factory jobs and work orders, no
          database, no Orca. Linking moves local state only.
        </div>
      </div>
      <OrcaLinksView
        counts={counts}
        groups={groups}
        links={links}
        suggestFor={(g) => suggestOrders(g, SAMPLE_ORDERS)}
        busyJob={busyJob}
        message={message}
        onSave={save}
        onRemove={remove}
      />
    </div>
  );
}
