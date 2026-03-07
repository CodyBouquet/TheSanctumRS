import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve(process.cwd(), "data");
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT_PATH = path.join(OUT_DIR, "items-osrs.json");

// Compact list of { id, name } for all OSRS items
const OSRS_SUMMARY_URL = "https://www.osrsbox.com/osrsbox-db/items-summary.json";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonRetry(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "GE-Monitor osrs indexer",
          "Accept": "application/json,text/plain,*/*",
        },
      });

      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);

      const text = (await r.text()).trimStart();
      if (!(text.startsWith("{") || text.startsWith("["))) {
        throw new Error("Non-JSON response");
      }
      return JSON.parse(text);
    } catch (e) {
      const wait = 800 * Math.pow(2, i);
      console.log(`[osrs] fetch failed (${e.message}). retrying in ${wait}ms…`);
      await sleep(wait);
    }
  }
  return null;
}

(async () => {
  console.log("OSRS index build starting…");
  console.log("Downloading OSRS item summary…");

  const data = await fetchJsonRetry(OSRS_SUMMARY_URL);
  if (!data) throw new Error("Failed to download OSRS item list.");

  // OSRSBox items-summary.json is typically an array of objects with id/name.
  // We'll support both array and object shapes just in case.
  let rows = [];
  if (Array.isArray(data)) rows = data;
  else if (Array.isArray(data?.items)) rows = data.items;
  else rows = Object.values(data);

  const items = [];
  let n = 0;

  for (const row of rows) {
    const id = row?.id ?? row?.item_id ?? row?.key;
    const name = row?.name ?? row?.item_name ?? row?.value;
    if (id == null || !name) continue;

    items.push({
      game: "osrs",
      id: String(id),
      name: String(name),
      icon: null,
      members: null,
      type: null,
    });

    n++;
    if (n % 5000 === 0) console.log(`Processed ${n}…`);
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify({ builtAt: new Date().toISOString(), items }, null, 2),
    "utf8"
  );

  console.log(`OSRS done. Wrote ${items.length} items -> ${OUT_PATH}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

