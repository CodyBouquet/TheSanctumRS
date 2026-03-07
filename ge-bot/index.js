import "dotenv/config";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

const GE = (process.env.GE_BASE_URL || "").replace(/\/$/, "");
if (!GE) throw new Error("Missing GE_BASE_URL in .env");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) throw new Error("Missing DISCORD_TOKEN in .env");

// --- helpers ---
function fmtGp(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString()} gp`;
}

function toSeries(graph) {
  const daily = Object.entries(graph?.daily || {})
    .map(([t, p]) => ({ t: Number(t), daily: Number(p) }))
    .sort((a, b) => a.t - b.t);

  const avg = Object.entries(graph?.average || {})
    .map(([t, p]) => ({ t: Number(t), avg: Number(p) }))
    .sort((a, b) => a.t - b.t);

  const map = new Map(daily.map((x) => [x.t, { t: x.t, daily: x.daily }]));
  for (const a of avg) map.set(a.t, { ...(map.get(a.t) || { t: a.t }), avg: a.avg });

  return [...map.values()];
}

function median(nums) {
  const arr = nums.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function statsFromSeries(series, days) {
  const vals = series
    .map((x) => (Number.isFinite(x.daily) ? x.daily : null))
    .filter((v) => v != null);

  if (!vals.length) return null;

  const window = days ? vals.slice(-days) : vals;
  if (!window.length) return null;

  return {
    current: window[window.length - 1],
    low: Math.min(...window),
    high: Math.max(...window),
    median: median(window),
  };
}

// --- network with timeout (prevents hanging forever) ---
async function fetchWithTimeout(url, { timeoutMs = 8000, ...opts } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url) {
  // cache-bust helps on CDNs/static-ish deployments where responses can get stuck
  const sep = url.includes("?") ? "&" : "?";
  const finalUrl = `${url}${sep}_=${Date.now()}`;

  const r = await fetchWithTimeout(finalUrl, {
    cache: "no-store",
    timeoutMs: 10000,
    headers: { "User-Agent": "TheSanctumRS GE Bot" },
  });

  const text = await r.text();

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // ignore parse errors
  }

  if (!r.ok) {
    const msg = data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }

  if (data?.error) throw new Error(data.error);
  return data;
}

// Returns up to 25 items for autocomplete
async function searchRs3(query) {
  const s = await getJson(`${GE}/api/ge/search?game=rs3&q=${encodeURIComponent(query)}`);
  return s.items || [];
}

async function searchTopRs3(query) {
  const items = await searchRs3(query);
  return items.length ? items[0] : null;
}

// Parse the /price query option value.
// If user selected from autocomplete, value looks like: "12345|Abyssal whip"
function parseSelectedQuery(raw) {
  const s = String(raw || "");
  const pipe = s.indexOf("|");
  if (pipe > 0) {
    const id = s.slice(0, pipe).trim();
    const name = s.slice(pipe + 1).trim();
    if (/^\d+$/.test(id)) return { id, name, fromAutocomplete: true };
  }
  return { id: null, name: s.trim(), fromAutocomplete: false };
}

// --- discord client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  // ✅ AUTOCOMPLETE HANDLER
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== "price") return;

    const focused = interaction.options.getFocused(true);
    if (focused.name !== "query") return;

    const q = String(focused.value || "").trim();
    if (!q) {
      // no suggestions until they type something
      await interaction.respond([]);
      return;
    }

    try {
      const items = await searchRs3(q);

      // Discord allows max 25 choices
      const choices = items.slice(0, 25).map((it) => {
        const name = String(it.name || `Item ${it.id}`).slice(0, 90); // keep it safe
        const id = String(it.id || "");
        // label shown to user
        const display = `${name} (#${id})`.slice(0, 100);
        // value passed back to your command (must be <= 100)
        const value = `${id}|${name}`.slice(0, 100);
        return { name: display, value };
      });

      await interaction.respond(choices);
    } catch (e) {
      // If your site is down / search endpoint errors, fail silently so Discord UI doesn't freak out
      console.error("Autocomplete error:", e?.message || e);
      await interaction.respond([]);
    }
    return;
  }

  // ✅ SLASH COMMAND HANDLER
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "price") return;

  const rawQuery = interaction.options.getString("query", true);
  const parsed = parseSelectedQuery(rawQuery);

  // ACK ASAP so Discord never times out
  try {
    await interaction.deferReply();
  } catch (e) {
    console.error("Failed to deferReply:", e);
    return;
  }

  try {
    let top = null;

    if (parsed.id) {
      // user selected a specific item from autocomplete
      top = { id: parsed.id, name: parsed.name };
    } else {
      // user typed freeform text; pick best match from search
      top = await searchTopRs3(parsed.name);
    }

    if (!top) {
      await interaction.editReply(`No RS3 results for **${parsed.name || rawQuery}**.`);
      return;
    }

    const [detail, graph] = await Promise.all([
      getJson(`${GE}/api/ge/detail?game=rs3&id=${encodeURIComponent(top.id)}`),
      getJson(`${GE}/api/ge/graph?game=rs3&id=${encodeURIComponent(top.id)}`),
    ]);

    const item = detail?.item || {};
    const series = toSeries(graph);
    const week = statsFromSeries(series, 7);

    const currentStr = item.current?.price ? `${item.current.price} gp` : "—";

    const embed = new EmbedBuilder()
      .setTitle(item.name || top.name || `Item ${top.id}`)
      .setDescription(item.description ? String(item.description).slice(0, 300) : "")
      .setFooter({ text: `RS3 • Item ID ${top.id}` });

    const thumb = item.icon_large || item.icon || top.icon;
    if (typeof thumb === "string" && thumb.startsWith("http")) {
      embed.setThumbnail(thumb);
    }

    embed.addFields(
      { name: "Current Price", value: currentStr, inline: true },
      {
        name: "Week stats (daily average)",
        value: week
          ? `Low ${fmtGp(week.low)}\nMed ${fmtGp(week.median)}\nHigh ${fmtGp(week.high)}`
          : "—",
        inline: true,
      }
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || "failed to fetch price");
    await interaction.editReply(`⚠️ ${msg.slice(0, 1800)}`);
  }
});

client.login(TOKEN);
