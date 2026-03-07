// app/api/ge/detail/route.js
// Fetches item details from Jagex ItemDB (RS3/OSRS) and fails gracefully if upstream is down.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASES = {
  rs3: "https://services.runescape.com/m=itemdb_rs",
  osrs: "https://services.runescape.com/m=itemdb_oldschool",
};

function isProbablyJson(text) {
  const t = (text || "").trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

async function fetchUpstreamJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "GE-Monitor",
      Accept: "application/json,text/plain,*/*",
    },
    cache: "no-store",
  });

  const text = await res.text();

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `Upstream HTTP ${res.status}`,
      raw: text.slice(0, 300),
    };
  }

  if (!isProbablyJson(text)) {
    return {
      ok: false,
      status: 502,
      error: "Upstream returned non-JSON (likely HTML/rate-limit page)",
      raw: text.slice(0, 300),
    };
  }

  try {
    const data = JSON.parse(text);
    return { ok: true, status: 200, data };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Upstream returned invalid JSON (truncated/garbled)",
      raw: text.slice(0, 300),
    };
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const game = (searchParams.get("game") || "").toLowerCase();
    const id = searchParams.get("id");

    if (!game || !id) {
      return Response.json(
        { error: "Missing required params: game, id" },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const base = BASES[game];
    if (!base) {
      return Response.json(
        { error: `Invalid game. Use one of: ${Object.keys(BASES).join(", ")}` },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const upstreamUrl = `${base}/api/catalogue/detail.json?item=${encodeURIComponent(id)}`;
    const upstream = await fetchUpstreamJson(upstreamUrl);

    if (!upstream.ok) {
      console.error("[detail] upstream error", {
        game,
        id,
        upstreamUrl,
        status: upstream.status,
        error: upstream.error,
        raw: upstream.raw,
      });

      return Response.json(
        { error: "Upstream service unavailable", upstreamStatus: upstream.status },
        { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return Response.json(upstream.data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    console.error("[detail] unexpected error", err);
    return Response.json(
      { error: "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
