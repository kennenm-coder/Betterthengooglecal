"use client";

// Live More for More rates + people for the form, loaded once and shared.
// The settings page calls refreshMfmSettings() after a save so an open form
// picks the new numbers up. Until the first load finishes, the paper sheet's
// rates stand in (the form never waits on this to draw).

import { useEffect, useState } from "react";
import { DEFAULT_RATES, normalizeRates, type MfmRates } from "@/lib/more-for-more";
import { fetchMfmPeople, fetchMfmRates, type MfmPerson } from "@/lib/more-for-more-settings";

const TTL_MS = 5 * 60_000;
const EVENT = "mfm-settings-changed";

type Settings = { rates: MfmRates; people: MfmPerson[] };
let cache: { at: number; value: Settings } | null = null;
let inflight: Promise<Settings> | null = null;

async function load(force = false): Promise<Settings> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const [rates, people] = await Promise.all([
      fetchMfmRates().catch(() => normalizeRates(DEFAULT_RATES)),
      fetchMfmPeople().catch(() => [] as MfmPerson[]),
    ]);
    const value = { rates, people };
    cache = { at: Date.now(), value };
    return value;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function refreshMfmSettings() {
  cache = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function useMfmSettings(): Settings & { loading: boolean } {
  const [value, setValue] = useState<Settings | null>(() => cache?.value ?? null);

  useEffect(() => {
    let live = true;
    const run = (force = false) =>
      load(force).then((v) => {
        if (live) setValue(v);
      });
    run();
    const onChange = () => run(true);
    window.addEventListener(EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  return {
    rates: value?.rates ?? normalizeRates(DEFAULT_RATES),
    people: value?.people ?? [],
    loading: !value,
  };
}
