"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Back button closes pop-ups instead of the app.
 *
 * Android's back button (Samsung especially, and the browser's own back) goes
 * to the previous history entry. Pop-ups here are just React state, so without
 * this the phone sees no earlier step and back closes the whole app. Each open
 * pop-up gets a history entry on the same page; back pops that entry and the
 * pop-up closes. Closing a pop-up any other way (X, backdrop, Done) removes
 * its entry again so the history never fills with dead steps.
 *
 * Every entry carries how many pop-ups deep it is. After any pop-up opens or
 * closes, history is settled to match: one entry per open pop-up on this page,
 * no more, no fewer. On back, every pop-up deeper than the entry we landed on
 * is closed.
 *
 * A pop-up can also carry a key (e.g. "order:123"). If the user leaves the
 * page from inside it (Open Install Instructions) and comes back, they land
 * on that pop-up's entry again, and the page can read the key to reopen it.
 */

const DEPTH = "__overlayDepth";
const KEY = "__overlayKey";

type Overlay = {
  /** Pop-ups opened in the same moment keep parent-before-child order. */
  batch: number;
  seq: number;
  key: string | null;
  /** The page it was opened on; a page already left is never touched. */
  path: string;
  close: () => void;
  alive: () => boolean;
};

/** Open pop-ups, bottom first. Index i owns the entry at depth i + 1. */
const stack: Overlay[] = [];
let listening = false;
let renderSeq = 0;
let batch = 0;

// history.back() is async: settling waits for the popstate it causes (or a
// fallback timer, if none comes).
let pendingBacks = 0;
let queue: (() => void)[] = [];
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileScheduled = false;
let touchedPaths = new Set<string>();

function current(): Record<string, unknown> {
  const s = window.history.state;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
}

function depthOf(s: unknown): number {
  const d = (s as Record<string, unknown> | null)?.[DEPTH];
  return typeof d === "number" ? d : 0;
}

function here(): string {
  return window.location.pathname;
}

function flush() {
  pendingBacks = 0;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  const q = queue;
  queue = [];
  q.forEach((fn) => fn());
}

function whenSettled(fn: () => void) {
  if (pendingBacks === 0) fn();
  else queue.push(fn);
}

function goBack(steps: number) {
  pendingBacks++;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(flush, 500);
  window.history.go(-steps);
}

function insert(o: Overlay) {
  if (stack.includes(o)) return;
  stack.push(o);
  stack.sort((a, b) => a.batch - b.batch || a.seq - b.seq);
}

function pruneDead() {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!stack[i].alive()) stack.splice(i, 1);
  }
}

function writeEntry(o: Overlay, depth: number, push: boolean) {
  // Spreading the current state keeps Next.js's own router data on the entry
  // (and anything a page saved there, like the search box text).
  const next = { ...current(), [DEPTH]: depth, [KEY]: o.key };
  if (push) window.history.pushState(next, "");
  else window.history.replaceState(next, "");
}

/** Make history match the open pop-ups: one entry each, in order. */
function reconcile() {
  const paths = touchedPaths;
  touchedPaths = new Set();
  batch++;
  pruneDead();
  // Pop-ups on a page the user already left (navigated from inside one) leave
  // history alone — the new page's entry is current now.
  if (!paths.has(here())) return;
  const want = stack.length;
  const have = depthOf(current());
  if (have > want) {
    // Entries for pop-ups that have closed: step back past them, then settle
    // again once the browser has moved.
    goBack(have - want);
    schedule(here());
    return;
  }
  // The entry we stand on belongs to the pop-up at that depth (this is how a
  // tile reopened after coming back reuses its old entry).
  if (have >= 1) writeEntry(stack[have - 1], have, false);
  for (let d = have + 1; d <= want; d++) writeEntry(stack[d - 1], d, true);
}

function schedule(path: string) {
  touchedPaths.add(path);
  if (reconcileScheduled) return;
  reconcileScheduled = true;
  // Wait a tick: React opens/closes several pop-ups in one go (a tile and the
  // form inside it), and a link inside a pop-up has put its page's entry in
  // place by then.
  setTimeout(() => {
    reconcileScheduled = false;
    whenSettled(reconcile);
  }, 0);
}

function onPopState(e: PopStateEvent) {
  if (pendingBacks > 0) {
    // Our own step back after a pop-up closed.
    flush();
    return;
  }
  const depth = depthOf(e.state);
  const popped = depth < stack.length ? stack.splice(depth) : [];
  // Top-most first, like pressing back on each in turn.
  for (let i = popped.length - 1; i >= 0; i--) {
    if (popped[i].alive()) popped[i].close();
  }
  if (popped.length === 0) return;
  // Some pop-ups refuse to close on the spot (a write-up with unsaved work
  // asks first; a sheet mid-save waits). Give them their entry back so the
  // next back press is caught again instead of closing the app.
  setTimeout(() => {
    for (const o of popped) {
      if (o.alive()) {
        insert(o);
        schedule(o.path);
      }
    }
  }, 150);
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", onPopState);
}

/**
 * Close this pop-up when the phone's back button is pressed.
 *
 * Call it inside a pop-up that is mounted only while open (pass nothing), or
 * pass `active` for one that stays mounted and toggles. `key` lets the page
 * reopen it after the user leaves from inside it and comes back — see
 * overlayKeyHere().
 */
export function useBackClose(
  onClose: () => void,
  opts: { active?: boolean; key?: string } = {}
) {
  const active = opts.active ?? true;
  const key = opts.key ?? null;
  // Render order: a parent renders before the pop-ups inside it.
  const [seq] = useState(() => ++renderSeq);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    listen();
    let alive = true;
    const o: Overlay = {
      batch,
      seq,
      key,
      path: here(),
      close: () => closeRef.current(),
      alive: () => alive,
    };
    insert(o);
    schedule(o.path);
    return () => {
      alive = false;
      schedule(o.path);
    };
  }, [active, key, seq]);
}

/**
 * The key of the pop-up whose history entry the page is standing on, if any —
 * set when the user went back to a page from inside one of its pop-ups.
 * Client-side only; read it after mount.
 */
export function overlayKeyHere(): string | null {
  if (typeof window === "undefined") return null;
  const s = current();
  if (depthOf(s) < 1) return null;
  return typeof s[KEY] === "string" ? (s[KEY] as string) : null;
}

/** Save a small value on the page's current history entry (survives back). */
export function savePageState(name: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.history.replaceState({ ...current(), [name]: value }, "");
}

/** Read a value saved with savePageState() on the current history entry. */
export function readPageState(name: string): unknown {
  if (typeof window === "undefined") return undefined;
  return current()[name];
}
