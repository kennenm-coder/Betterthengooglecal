"use client";

// Measures: the Tech Measure appointments assigned to the signed-in measure tech
// — where they are going and when. Read-only: nothing on this screen writes.
//
// Which appointments are "theirs" is decided in lib/measure-appointments.ts (a
// name match: rForce's free-text tech name against allowed_emails.name). That is
// presentation scoping, not access control — see measureScope in lib/roles.

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Loader2, RefreshCw, Ruler, ShieldX, WifiOff } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import MeasureAppointmentCard from "@/components/MeasureAppointmentCard";
import { useAuth } from "@/hooks/useAuth";
import { isMeasureTech, measureScope } from "@/lib/roles";
import { groupMeasureAppointments, measureToolsUrl, MEASURE_LOOKBACK_DAYS } from "@/lib/measure-appointments";
import {
  fetchMeasureAppointments,
  loadMeasureCache,
  saveMeasureCache,
  type MeasureFetch,
} from "@/lib/measure-appointments-store";

type Mode = "mine" | "all";
type Loaded = MeasureFetch & { key: string };

/** A list this old is refetched when the app comes back to the foreground. */
const STALE_AFTER_MS = 5 * 60 * 1000;

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return isNaN(d.getTime()) ? "" : format(d, "h:mm a");
}

export default function MeasuresPage() {
  const { roles, name, loading: authLoading } = useAuth();
  const scope = measureScope(roles);

  // A measure tech starts on their own list; an admin who is not one has none of
  // their own, so starts on everyone's. Anyone with scope "all" can flip it.
  const [chosen, setChosen] = useState<Mode | null>(null);
  const mode: Mode = scope === "all" ? chosen ?? (isMeasureTech(roles) ? "mine" : "all") : "mine";

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const toolsUrl = useMemo(() => measureToolsUrl(), []);

  const key = `${mode}|${name}`;

  useEffect(() => {
    if (authLoading || scope === "none") return;
    let cancelled = false;
    (async () => {
      const res = await fetchMeasureAppointments(mode, name);
      if (cancelled) return;
      if (res.error) {
        // No signal (or the lookup failed): fall back to the copy saved on this phone.
        const cached = mode === "mine" ? loadMeasureCache(name) : null;
        setLoaded({
          key,
          ...(cached
            ? { ...res, rows: cached.rows, fromCache: true, fetchedAt: cached.fetchedAt }
            : res),
        });
      } else {
        if (mode === "mine" && res.fetchedAt) saveMeasureCache(name, res.rows, res.fetchedAt);
        setLoaded({ key, ...res });
      }
      setNow(new Date());
      setRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, scope, mode, name, key, refreshTick]);

  // "Today" must roll over at midnight on a screen left open...
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ...and a phone that has been in a pocket should not show this morning's list.
  const fetchedAt = loaded?.fromCache ? null : loaded?.fetchedAt ?? null;
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible" || !fetchedAt) return;
      if (Date.now() - new Date(fetchedAt).getTime() > STALE_AFTER_MS) setRefreshTick((n) => n + 1);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchedAt]);

  const current = loaded && loaded.key === key ? loaded : null;
  const groups = useMemo(() => groupMeasureAppointments(current?.rows ?? [], now), [current, now]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  function refresh() {
    setRefreshing(true);
    setRefreshTick((n) => n + 1);
  }

  // ── States before there is a list ──
  if (authLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
        <BottomNav />
      </div>
    );
  }

  if (scope === "none") {
    return (
      <div className="flex flex-col h-full">
        <header className="bg-background border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Measures</h1>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-3">
            <ShieldX className="w-12 h-12 text-muted mx-auto" />
            <p className="font-medium">Measure tech access required</p>
            <p className="text-sm text-muted">
              This screen lists the Tech Measure appointments assigned to a measure tech.
            </p>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  const needsName = mode === "mine" && !name;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="bg-background border-b border-border px-4 py-3 z-20">
        <div className="flex items-center gap-2">
          <Ruler className="w-5 h-5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight">
              {mode === "mine" ? "My Measures" : "All Tech Measures"}
            </h1>
            {current && !needsName && (
              <p className="text-xs text-muted">
                {total} {total === 1 ? "appointment" : "appointments"}
                {current.fetchedAt && !current.fromCache && <> &middot; updated {timeLabel(current.fetchedAt)}</>}
              </p>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={refreshing || needsName}
            className="p-2 rounded-full hover:bg-surface disabled:opacity-50 shrink-0"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {scope === "all" && (
          <div className="flex bg-surface rounded-lg p-0.5 mt-2">
            {(["mine", "all"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setChosen(m)}
                className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                  mode === m ? "bg-background shadow-sm font-medium" : "text-muted"
                }`}
              >
                {m === "mine" ? "Mine" : "Everyone"}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y p-4 space-y-5">
        {needsName ? (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <p className="font-medium">Your account isn&apos;t finished yet</p>
            <p className="text-xs text-muted mt-0.5">
              Your login has no name on file, so there is nothing to match against the tech
              name in rForce. Ask an admin to add your name on the Team page, spelled the way
              rForce spells it.
            </p>
          </div>
        ) : !current ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {current.fromCache && (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
                <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Couldn&apos;t reach the server. Showing the list saved on this phone
                  {current.fetchedAt && <> at {timeLabel(current.fetchedAt)}</>}.
                </span>
              </div>
            )}

            {current.error && !current.fromCache && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-danger" />
                <div>
                  <p className="font-medium">Couldn&apos;t load your appointments</p>
                  <p className="text-xs text-muted mt-0.5">{current.error}</p>
                  <button onClick={refresh} className="text-xs text-primary font-medium mt-1">
                    Try again
                  </button>
                </div>
              </div>
            )}

            {!current.error || current.fromCache ? (
              groups.length === 0 ? (
                <div className="text-center py-12 text-muted">
                  <Ruler className="w-10 h-10 mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    {mode === "mine" ? "Nothing assigned to you right now" : "No open Tech Measure appointments"}
                  </p>
                  {mode === "mine" && (
                    <p className="text-xs mt-1 px-4">
                      Looking for appointments assigned to &ldquo;{name}&rdquo;. If you expect some
                      and none show, ask an admin to check that your name on the Team page
                      matches rForce exactly.
                    </p>
                  )}
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.key}>
                    <h2
                      className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide mb-2 ${
                        g.key === "overdue" ? "text-danger" : "text-muted"
                      }`}
                    >
                      {g.key === "overdue" && <AlertTriangle className="w-3.5 h-3.5" />}
                      {g.label}
                      <span className="font-normal normal-case tracking-normal">({g.items.length})</span>
                    </h2>
                    <ul className="space-y-2">
                      {g.items.map((a) => (
                        <MeasureAppointmentCard
                          key={a.id}
                          appointment={a}
                          group={g.key}
                          now={now}
                          showTech={mode === "all"}
                          toolsUrl={toolsUrl}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              )
            ) : null}

            {current.truncated && (
              <p className="text-xs text-muted text-center">
                Showing the first {current.rows.length} appointments only.
              </p>
            )}
            <p className="text-[11px] text-muted text-center pb-2">
              Shows everything coming up, plus anything still open from the last {MEASURE_LOOKBACK_DAYS} days
              {mode === "mine" && name && <> &middot; matched on the name &ldquo;{name}&rdquo;</>}
            </p>
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
