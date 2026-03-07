import fs from "fs";
import path from "path";
import { normalizeGame } from "../../../../lib/ge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function loadIndex(game) {
  const p = path.resolve(process.cwd(), "data", `items-${game}.json`);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const game = normalizeGame(searchParams.get("game"));
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  // Require at least 2 chars (prevents “show everything” + reduces spam)
  if (q.length < 2) {
    return Response.json(
      { items: [] },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }

  const idx = loadIndex(game);
  if (!idx) {
    return Response.json(
      { error: `Missing index for ${game}. Run: node scripts/build-index-${game}.mjs` },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }

  const items = idx.items || [];

  // scoring: startsWith > includes
  const starts = [];
  const includes = [];

  for (const it of items) {
    const name = (it.name || "").toLowerCase();
    if (!name) continue;

    if (name.startsWith(q)) starts.push(it);
    else if (name.includes(q)) includes.push(it);

    // keep scanning a little longer so we don’t stop early on a weird alphabet block
    if (starts.length >= 25 && includes.length >= 25) break;
  }

  const out = [...starts.slice(0, 25), ...includes.slice(0, 25)].slice(0, 25);

  return Response.json(
    { items: out },
    {
      headers: {
        // CRITICAL: disable caching so query changes work in prod
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
