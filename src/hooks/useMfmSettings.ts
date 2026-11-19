"use client";

// Live More for More rates + people for the form, loaded once and shared.
// The settings page calls refreshMfmSettings() after a save so an open form
// picks the new numbers up. Until the first load finishes, the paper sheet's
// rates stand in for DRAWING (the form never waits on this to draw) — but the
// form won't SAVE until the real rates are in (`loading` / `failed`), because
// a save stamps the sheet with whatever rates are showing.

import { useEffect, useState } from "react";
import { DEFAULT_RATES, normalizeRates, type MfmRates } from "@/lib/more-for-more";
import { fetchMfmPeople, fetchMfmRates, type MfmPerson } from "@/lib/more-for-more-settings";

const TTL_MS = 5 * 60_000;
const EVENT = "mfm-settings-changed";
// A failed load is tried again a few times while the form is open, a little
// later each time. Two tiny reads each, so this costs next to nothing.
const RETRY_MS = [3_000, 10_000, 30_000];

type Settings = { rates: MfmRates; people: MfmPerson[]; ratesFailed: boolean; failed: boolean };
let cache: { at: number; value: Settings } | null = null;
let inflight: Promise<Settings> | null = null;

async function load(force = false): Promise<Settings> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    let ratesFailed = false;
    let peopleFailed = false;
    const [rates, people] = await Promise.all([
      fetchMfmRates().catch(() => {
        ratesFailed = true;
        return normalizeRates(DEFAULT_RATES);
      }),
      fetchMfmPeople().catch(() => {
        peopleFailed = true;
        return [] as MfmPerson[];
      }),
    ]);
    const failed = ratesFailed || peopleFailed;
    const value = { rates, people, ratesFailed, failed };
    // Only a good answer is kept for five minutes. A fallback used to be
    // cached too, so one blip meant five minutes of paper-sheet rates and an
    // empty people list.
    if (!failed) cache = { at: Date.now(), value };
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

export function useMfmSettings(): {
  rates: MfmRates;
  people: MfmPerson[];
  /** True until the first answer arrives. */
  loading: boolean;
  /**
   * True only once today's real rates are in. Saving stamps a sheet with the
   * rates showing, so the form waits for this; until then (or while a failed
   * load is retried) the paper-sheet rates are only on screen.
   */
  ratesReady: boolean;
} {
  const [value, setValue] = useState<Settings | null>(() => cache?.value ?? null);

  useEffect(() => {
    let live = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (force = false) =>
      load(force).then((v) => {
        if (!live) return;
        setValue(v);
        if (v.failed && attempt < RETRY_MS.length) {
          timer = setTimeout(() => run(true), RETRY_MS[attempt++]);
        }
      });
    run();
    const onChange = () => run(true);
    window.addEventListener(EVENT, onChange);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  return {
    rates: value?.rates ?? normalizeRates(DEFAULT_RATES),
    people: value?.people ?? [],
    loading: !value,
    ratesReady: !!value && !value.ratesFailed,
  };
}
