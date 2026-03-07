// app/api/ge/graph/route.js
// Fetches item graph data from Jagex ItemDB (RS3/OSRS).
// IMPORTANT: no caching, so switching items updates immediately in prod/CDN.

import { BASES, normalizeGame } from "../../../../lib/ge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const game = normalizeGame(searchParams.get("game"));
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const url = `${BASES[game]}/api/graph/${encodeURIComponent(id)}.json`;

  const r = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "GE-Monitor (personal project)" },
  });

  if (!r.ok) {
    return Response.json(
      { error: "Upstream error", status: r.status },
      {
        status: 502,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  }

  const data = await r.json();

  return Response.json(data, {
    headers: {
      // Prevent Netlify/CDN/browser from serving stale graph data
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
