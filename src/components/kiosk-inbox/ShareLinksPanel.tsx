"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, ExternalLink, Loader2, QrCode, Settings, X } from "lucide-react";
import { useBackClose } from "@/hooks/useBackClose";
import type { ShareLinkView } from "@/lib/kiosk-inbox";
import { dayLabel } from "./InboxItemCard";

interface LinksResponse {
  links: ShareLinkView[];
  manageUrl: string | null;
  notSetUp?: boolean;
  missingKioskUrl?: boolean;
}

/**
 * The kiosk's public share links (no login, like a Microsoft Form), with a
 * Copy button for texting and a QR code for posters.
 *
 * The QR code is drawn here in the browser with the `qrcode` package. It is
 * never sent to an online QR service: the URL carries the link's secret token.
 *
 * Making, replacing, turning off and expiring links happens in the kiosk.
 */
export default function ShareLinksPanel() {
  const [data, setData] = useState<LinksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<ShareLinkView | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/kiosk-inbox/links");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Could not load the links");
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy(link: ShareLinkView) {
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      // Older browsers / insecure origins: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = link.url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(link.option_key);
    window.setTimeout(() => setCopied((c) => (c === link.option_key ? null : c)), 2000);
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted flex-1">
          Anyone with one of these links can fill that option in from their
          phone, no login. Copy one to text it, or show the QR code for a poster.
        </p>
        {data?.manageUrl && (
          <a
            href={data.manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-surface"
          >
            <Settings className="w-3.5 h-3.5" /> Manage links
            <ExternalLink className="w-3 h-3 text-muted" />
          </a>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}

      {!data && !error && (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted" />
        </div>
      )}

      {data?.notSetUp && (
        <p className="mt-3 text-sm text-muted">
          Share links are not set up in the database yet.
        </p>
      )}
      {data?.missingKioskUrl && (
        <p className="mt-3 text-sm text-muted">
          The kiosk&apos;s web address (KIOSK_APP_URL) is not configured here, so
          links cannot be built.
        </p>
      )}
      {data && !data.notSetUp && !data.missingKioskUrl && data.links.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          No live links. Make them in the kiosk under Manage links.
        </p>
      )}

      {data && data.links.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-background">
          {data.links.map((l) => (
            <li key={l.option_key} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{l.title}</p>
                <p className="truncate font-mono text-[11px] text-muted">{l.url}</p>
                {l.expires_at && (
                  <p className="text-[11px] text-warning">
                    Stops working {dayLabel(l.expires_at.slice(0, 10))}
                  </p>
                )}
              </div>
              <button
                onClick={() => copy(l)}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface"
              >
                {copied === l.option_key ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-rba-green" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </>
                )}
              </button>
              <button
                onClick={() => setQrFor(l)}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface"
              >
                <QrCode className="w-3.5 h-3.5" /> QR code
              </button>
            </li>
          ))}
        </ul>
      )}

      {qrFor && <QrDialog link={qrFor} onClose={() => setQrFor(null)} />}
    </div>
  );
}

function QrDialog({ link, onClose }: { link: ShareLinkView; onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useBackClose(onClose);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(link.url, { type: "svg", errorCorrectionLevel: "M", margin: 2 })
      .then((s) => {
        if (!cancelled) setSvg(s);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [link.url]);

  /** A big PNG for a poster, made here in the browser. */
  async function downloadPng() {
    const dataUrl = await QRCode.toDataURL(link.url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 1024,
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${link.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`;
    a.click();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{link.title}</h2>
            <p className="text-xs text-muted">Scan with a phone camera to open it.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-surface">
            <X className="w-4 h-4 text-muted" />
          </button>
        </div>

        <div className="mt-4 flex aspect-square items-center justify-center rounded-lg bg-white p-2">
          {svg ? (
            // Generated locally by the qrcode package from our own URL.
            <div
              className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : failed ? (
            <p className="text-sm text-danger">Could not draw the QR code.</p>
          ) : (
            <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
          )}
        </div>

        <p className="mt-3 break-all font-mono text-[11px] text-muted">{link.url}</p>

        <button
          onClick={downloadPng}
          disabled={!svg}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-rba-green py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          <Download className="w-4 h-4" /> Download for a poster
        </button>
      </div>
    </div>
  );
}
