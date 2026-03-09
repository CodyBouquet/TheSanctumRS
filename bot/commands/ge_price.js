import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

const GE = (process.env.GE_BASE_URL || "").replace(/\/$/, "");

// Format numbers as gp
function fmtGp(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString()} gp`;
}

// Calculate median of an array
function median(nums) {
  const arr = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

// Fetch JSON with cache buster
async function getJson(url) {
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(url + `${sep}_=${Date.now()}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.error || `Request failed (${r.status})`);
  }
  return r.json();
}

// Search items by name
async function searchRs3(query) {
  const s = await getJson(`${GE}/api/ge/search?game=rs3&q=${encodeURIComponent(query)}`);
  return s.items || [];
}

// Convert graph data to series
function toSeries(graph) {
  const daily = Object.entries(graph?.daily || {})
    .map(([t, p]) => ({ t: Number(t), daily: Number(p) }))
    .sort((a, b) => a.t - b.t);
  return daily;
}

// Get week stats from series
function statsFromSeries(series) {
  const vals = series.map(x => x.daily).filter(Number.isFinite);
  if (!vals.length) return null;
  const last7 = vals.slice(-7);
  return {
    current: last7[last7.length - 1],
    low: Math.min(...last7),
    high: Math.max(...last7),
    median: median(last7),
  };
}

// Parse input (id|name or just name)
function parseQuery(raw) {
  const s = String(raw);
  const pipe = s.indexOf("|");
  if (pipe > 0) {
    const id = s.slice(0, pipe);
    const name = s.slice(pipe + 1);
    return { id, name };
  }
  return { id: null, name: s };
}

export default {
  data: new SlashCommandBuilder()
    .setName("price")
    .setDescription("Get RS3 GE price + quick stats")
    .addStringOption(opt =>
      opt.setName("query")
        .setDescription("Type to search")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  // Autocomplete handler
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    if (!focused) return interaction.respond([]);
    try {
      const items = await searchRs3(focused);
      const choices = items.slice(0, 25).map(it => ({
        name: `${it.name} (#${it.id})`.slice(0, 100),
        value: `${it.id}|${it.name}`.slice(0, 100),
      }));
      await interaction.respond(choices);
    } catch (e) {
      console.error("Autocomplete error:", e);
      await interaction.respond([]);
    }
  },

  // Execute handler
  async execute(interaction) {
    const raw = interaction.options.getString("query", true);
    const parsed = parseQuery(raw);

    await interaction.deferReply({ ephemeral: true }); // Silent reply, no pings

    try {
      let item;
      if (parsed.id) {
        item = { id: parsed.id, name: parsed.name };
      } else {
        const search = await searchRs3(parsed.name);
        if (!search.length) {
          return interaction.editReply(`No results for **${parsed.name}**`);
        }
        item = search[0];
      }

      const [detail, graph] = await Promise.all([
        getJson(`${GE}/api/ge/detail?game=rs3&id=${item.id}`),
        getJson(`${GE}/api/ge/graph?game=rs3&id=${item.id}`)
      ]);

      const series = toSeries(graph);
      const week = statsFromSeries(series);

      const embed = new EmbedBuilder()
        .setTitle(detail.item?.name || item.name)
        .setDescription(detail.item?.description?.slice(0, 300) || "")
        .setFooter({ text: `RS3 • Item ID ${item.id}` });

      if (detail.item?.icon_large) {
        embed.setThumbnail(detail.item.icon_large);
      }

      // ✅ Fix: always use string for value
      embed.addFields(
        {
          name: "Current Price",
          value: fmtGp(detail.item?.current?.price),
          inline: true
        },
        {
          name: "Week stats",
          value: week
            ? `Low ${fmtGp(week.low)}\nMed ${fmtGp(week.median)}\nHigh ${fmtGp(week.high)}`
            : "—",
          inline: true,
        }
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (e) {
      console.error(e);
      await interaction.editReply(`⚠️ ${e.message}`);
    }
  }
};