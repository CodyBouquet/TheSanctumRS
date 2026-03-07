// scripts/build-index-rs3.mjs
// RS3 GE-tradeable index builder (FAST + COMPLETE) using Weird Gloop GEBot dump.
//
// Input:  https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json
// Output: data/items-rs3.json
//
// Why this approach:
// - Jagex ItemDB paging often fails/throttles and can miss items when crawling categories.
// - The dump already contains the GE-tradeable universe + core fields in one shot.
//
// Notes:
// - We generate a stable icon URL via Jagex obj_big endpoint.
//   (This is the stable format without the runedate prefix.)
//
// Run:
//   node scripts/build-index-rs3.mjs

import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve(process.cwd(), "data");
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT_FILE = path.join(OUT_DIR, "items-rs3.json");

// Data source
const DUMP_URL = "https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json";

// Stable icon endpoint (no runedate prefix)
const ICON_BIG = (id) => `https://services.runescape.com/m=itemdb_rs/obj_big.gif?id=${id}`;

// Retry/backoff
const FETCH_TRIES = 8;
const BACKOFF_BASE_MS = 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(code) {
  return code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
}

function isProbablyJson(text) {
  if (!text) return false;
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

async function fetchJsonWithRetries(url, tries = FETCH_TRIES) {
  let lastErr = null;

  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "TheSanctumRS GE Monitor (rs3 indexer)",
          "Accept": "application/json,text/plain,*/*",
        },
      });

      if (!res.ok) {
        if (isRetryableStatus(res.status)) {
          const wait = BACKOFF_BASE_MS * Math.pow(2, i);
          console.log(`[rs3] HTTP ${res.status} — retrying in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      if (!isProbablyJson(text)) throw new Error("Non-JSON response");

      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      const wait = BACKOFF_BASE_MS * Math.pow(2, i);
      console.log(`[rs3] fetch failed (${e?.message || e}) — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Failed to fetch JSON");
}

function writeOut(items, meta = {}) {
  const payload = {
    builtAt: new Date().toISOString(),
    source: "weirdgloop_gazbot_rs_dump",
    ...meta,
    items,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function normalizeBool(v) {
  // dump uses booleans; keep robust
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
}

function itemFromDumpEntry(key, obj) {
  // Keys are usually string item IDs, but dump also includes metadata keys like %JAGEX_TIMESTAMP%
  // Prefer obj.id if present and numeric.
  const idNum = Number(obj?.id ?? key);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;

  const name = String(obj?.name ?? "").trim();
  if (!name) return null;

  return {
    game: "rs3",
    id: String(idNum),
    name,
    icon: ICON_BIG(idNum),
    members: normalizeBool(obj?.members),
    // dump doesn't provide the same "type" categories Jagex ItemDB listing does
    // keep null to avoid lying; your UI can ignore it.
    type: null,
  };
}

(async () => {
  console.log("[rs3] downloading rs_dump.json …");
  const dump = await fetchJsonWithRetries(DUMP_URL);

  if (!dump || typeof dump !== "object") {
    throw new Error("[rs3] dump is not an object");
  }

  // Extract meta keys if present
  const jagexTs = dump["%JAGEX_TIMESTAMP%"] ?? null;
  const detected = dump["%UPDATE_DETECTED%"] ?? null;

  const items = [];
  const seen = new Set();

  // Main parse
  for (const [k, v] of Object.entries(dump)) {
    // skip metadata keys
    if (k.startsWith("%") && k.endsWith("%")) continue;
    if (!v || typeof v !== "object") continue;

    const rec = itemFromDumpEntry(k, v);
    if (!rec) continue;

    const key = `rs3:${rec.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(rec);
  }

  // Sort by name for nice UX in search
  items.sort((a, b) => a.name.localeCompare(b.name));

  // Sanity check: a few “must exist” examples
  const mustHave = ["4151"]; // abyssal whip (common test)
  const haveIds = new Set(items.map((x) => x.id));
  for (const id of mustHave) {
    if (!haveIds.has(id)) console.log(`[rs3][warn] expected id ${id} not found (unexpected)`);
  }

  writeOut(items, {
    jagexTimestamp: jagexTs,
    updateDetected: detected,
    count: items.length,
  });

  console.log(`[rs3] done. wrote ${items.length} items → ${OUT_FILE}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
