"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeGame } from "../../lib/ge";
import { addToWatchlist, loadWatchlist, removeFromWatchlist } from "../../lib/watchlist";

import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

const MATRIX_GREEN = "#00ff41";
const MATRIX_GRID = "rgba(0,255,65,0.15)";
const MIN_SEARCH_CHARS = 2;

function toSeries(graph) {
  const daily = Object.entries(graph?.daily || {})
    .map(([t, p]) => ({ t: Number(t), daily: Number(p) }))
    .sort((a, b) => a.t - b.t);

  const avg = Object.entries(graph?.average || {})
    .map(([t, p]) => ({ t: Number(t), avg: Number(p) }))
    .sort((a, b) => a.t - b.t);

  const map = new Map(daily.map((x) => [x.t, { t: x.t, daily: x.daily }]));
  for (const a of avg) map.set(a.t, { ...(map.get(a.t) || { t: a.t }), avg: a.avg });

  return [...map.values()].map((x) => ({
    ...x,
    label: new Date(x.t).toLocaleDateString(),
  }));
}

function formatGp(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString()} gp`;
}

function median(nums) {
  const arr = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function statsFromSeries(series, windowDays) {
  const vals = series
    .map((x) => (Number.isFinite(x.daily) ? x.daily : null))
    .filter((v) => v != null);

  if (!vals.length) return null;

  const window = windowDays ? vals.slice(-windowDays) : vals;
  if (!window.length) return null;

  const current = window[window.length - 1];
  const low = Math.min(...window);
  const high = Math.max(...window);
  const med = median(window);

  return { current, low, median: med, high, count: window.length };
}

export default function GEPage() {
  const [game, setGame] = useState("rs3");

  // ✅ no default item
  const [id, setId] = useState("");
  const [range, setRange] = useState("week"); // "day" | "week"

  const [detail, setDetail] = useState(null);
  const [graph, setGraph] = useState(null);

  // ✅ no noisy error by default
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [watchlist, setWatchlist] = useState([]);

  // Search UI
  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const searchTimer = useRef(null);
  const [showResults, setShowResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    setWatchlist(loadWatchlist());
  }, []);

  const series = useMemo(() => (graph ? toSeries(graph) : []), [graph]);

  const priceStats = useMemo(() => {
    if (!series.length) return null;
    if (range === "day") return statsFromSeries(series, 1);
    return statsFromSeries(series, 7);
  }, [series, range]);

  const watchKey = id ? `${normalizeGame(game)}:${id}` : "";
  const isWatched = !!id && watchlist.some((x) => `${x.game}:${x.id}` === watchKey);

  async function load(currentGame = game, currentId = id) {
    // ✅ if no id selected, don't load or error
    if (!currentId) return;

    setErr("");
    setLoading(true);

    try {
      const d = await fetch(`/api/ge/detail?game=${currentGame}&id=${currentId}`).then((r) => r.json());
      if (d?.error) throw new Error(d.error);
      setDetail(d);

      const g = await fetch(`/api/ge/graph?game=${currentGame}&id=${currentId}`).then((r) => r.json());
      if (g?.error) throw new Error(g.error);
      setGraph(g);
    } catch (e) {
      // ✅ show a friendly message only if something fails AFTER selection
      setErr(e?.message || "Could not load item. Try searching again.");
    } finally {
      setLoading(false);
    }
  }

  // ✅ Auto-refresh only when an item is selected
  useEffect(() => {
    if (!id) return;

    load(game, id);
    const t = setInterval(() => load(game, id), 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, id]);

  // Debounced search (only fetch after MIN_SEARCH_CHARS)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const query = q.trim();

    if (query.length < MIN_SEARCH_CHARS) {
      setSearchResults([]);
      setActiveIndex(-1);
      return;
    }

    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ge/search?game=${game}&q=${encodeURIComponent(query)}`).then((r) => r.json());
        if (res?.error) {
          // ✅ don't surface search errors loudly; just clear results
          setSearchResults([]);
          setActiveIndex(-1);
          return;
        }
        setSearchResults(res.items || []);
        setActiveIndex(-1);
      } catch {
        setSearchResults([]);
        setActiveIndex(-1);
      }
    }, 200);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [q, game]);

  function pickItem(it) {
    const newId = String(it.id);
    setId(newId);
    setQ(it.name);
    setSearchResults([]);
    setShowResults(false);
    setActiveIndex(-1);

    // ✅ load immediately on pick
    load(game, newId);
  }

  function toggleWatch() {
    if (!id) return;

    const g = normalizeGame(game);
    const itemName = detail?.item?.name;

    if (isWatched) setWatchlist(removeFromWatchlist(g, String(id)));
    else setWatchlist(addToWatchlist({ game: g, id: String(id), name: itemName }));
  }

  const chartData = useMemo(() => {
    if (!series.length) return null;
    const labels = series.map((x) => x.label);

    return {
      labels,
      datasets: [
        {
          label: "Daily",
          data: series.map((x) => (Number.isFinite(x.daily) ? x.daily : null)),
          tension: 0.2,

          borderColor: MATRIX_GREEN,
          borderWidth: 2,

          pointBackgroundColor: MATRIX_GREEN,
          pointBorderColor: MATRIX_GREEN,
          pointBorderWidth: 2,
          pointRadius: 3,

          pointHoverBackgroundColor: MATRIX_GREEN,
          pointHoverBorderColor: MATRIX_GREEN,
          pointHoverBorderWidth: 2,
          pointHoverRadius: 5,
        },
        {
          label: "Average",
          data: series.map((x) => (Number.isFinite(x.avg) ? x.avg : null)),
          tension: 0.2,

          borderColor: "rgba(255, 255, 255, 0.75)",
          borderWidth: 2,

          pointBackgroundColor: "#ffffff",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointRadius: 2,

          pointHoverBackgroundColor: "#ffffff",
          pointHoverBorderColor: "#ffffff",
          pointHoverBorderWidth: 2,
          pointHoverRadius: 4,
        },
      ],
    };
  }, [series]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      plugins: {
        legend: { display: true, labels: { color: MATRIX_GREEN } },
        tooltip: {
          backgroundColor: "#000",
          titleColor: MATRIX_GREEN,
          bodyColor: MATRIX_GREEN,
          borderColor: MATRIX_GREEN,
          borderWidth: 1,
        },
      },
      scales: {
        x: { ticks: { color: MATRIX_GREEN }, grid: { color: MATRIX_GRID } },
        y: {
          ticks: { color: MATRIX_GREEN, callback: (v) => Number(v).toLocaleString() },
          grid: { color: MATRIX_GRID },
        },
      },
    };
  }, []);

  const hasSelection = !!id;

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>GE Monitor</h1>
        <Link href="/" className="small">
          ← Home
        </Link>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <label className="small">Game</label>
          <select
            value={game}
            onChange={(e) => {
              setGame(e.target.value);
              // keep selection? you can choose:
              setId("");
              setDetail(null);
              setGraph(null);
              setErr("");
              setQ("");
              setSearchResults([]);
              setShowResults(false);
              setActiveIndex(-1);
            }}
          >
            <option value="rs3">RS3</option>
            <option value="osrs">OSRS</option>
          </select>

          <label className="small">Search</label>
          <div className="searchWrap">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                const val = e.target.value;
                setQ(val);
                setShowResults(val.trim().length >= MIN_SEARCH_CHARS);
                setActiveIndex(-1);
              }}
              onFocus={() => setShowResults(q.trim().length >= MIN_SEARCH_CHARS)}
              onBlur={() => setTimeout(() => setShowResults(false), 120)}
              onKeyDown={(e) => {
                const visible =
                  showResults && q.trim().length >= MIN_SEARCH_CHARS && searchResults.length > 0;
                if (!visible) return;

                const max = Math.min(searchResults.length, 10);

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, max - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = searchResults[Math.max(0, activeIndex)];
                  if (pick) pickItem(pick);
                } else if (e.key === "Escape") {
                  setShowResults(false);
                }
              }}
              placeholder={`Type item name… (min ${MIN_SEARCH_CHARS} chars)`}
              style={{ width: 360 }}
            />

            {showResults && q.trim().length >= MIN_SEARCH_CHARS && searchResults.length > 0 && (
              <div className="searchDropdown">
                {searchResults.slice(0, 10).map((it, idx) => (
                  <button
                    type="button"
                    key={`${it.game}:${it.id}`}
                    className={`searchItem ${idx === activeIndex ? "active" : ""}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickItem(it)}
                  >
                    <span className="searchItemName">{it.name}</span>
                    <span className="small">#{it.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="small">Item ID</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. 4151"
            style={{ width: 120 }}
          />

          <button onClick={() => load(game, id)} disabled={loading || !id}>
            {loading ? "Loading…" : "Reload"}
          </button>

          <button onClick={toggleWatch} disabled={!id}>
            {isWatched ? "Remove Watch" : "Add Watch"}
          </button>
        </div>

        {/* ✅ Friendly prompt instead of error when no selection */}
        {!hasSelection && (
          <p className="small" style={{ marginBottom: 0 }}>
            Search for an item to begin.
          </p>
        )}

        {/* ✅ Only show errors after a selection exists */}
        {hasSelection && err && <p style={{ color: "salmon", marginBottom: 0 }}>{err}</p>}

        {hasSelection && (
          <p className="small" style={{ marginBottom: 0 }}>
            Auto-refresh: every <b>minute</b>. (Manual reload button also available.)
          </p>
        )}
      </div>

      {detail?.item && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: "0 0 6px 0" }}>{detail.item.name}</h2>
              <div className="small">{detail.item.description}</div>

              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div className="small" style={{ opacity: 0.85 }}>
                    Prices
                  </div>

                  <div className="row" style={{ gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setRange("day")}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        opacity: range === "day" ? 1 : 0.6,
                        border:
                          range === "day"
                            ? "1px solid rgba(0,255,65,0.8)"
                            : "1px solid rgba(0,255,65,0.25)",
                      }}
                    >
                      Day
                    </button>
                    <button
                      type="button"
                      onClick={() => setRange("week")}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        opacity: range === "week" ? 1 : 0.6,
                        border:
                          range === "week"
                            ? "1px solid rgba(0,255,65,0.8)"
                            : "1px solid rgba(0,255,65,0.25)",
                      }}
                    >
                      Week
                    </button>
                  </div>
                </div>

                <div className="row" style={{ gap: 18 }}>
                  <div>
                    <div className="small">Current</div>
                    <b>{formatGp(priceStats?.current)}</b>
                  </div>
                  <div>
                    <div className="small">Low</div>
                    <b>{formatGp(priceStats?.low)}</b>
                  </div>
                  <div>
                    <div className="small">Median</div>
                    <b>{formatGp(priceStats?.median)}</b>
                  </div>
                  <div>
                    <div className="small">High</div>
                    <b>{formatGp(priceStats?.high)}</b>
                  </div>
                </div>
              </div>
            </div>

            {detail.item.icon_large && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={detail.item.icon_large}
                alt={detail.item.name}
                width={96}
                height={96}
                style={{ borderRadius: 12 }}
              />
            )}
          </div>
        </div>
      )}

      {chartData && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Price history</h3>
          <Line data={chartData} options={chartOptions} />
          <div className="small" style={{ marginTop: 10 }}>
            Data source: Jagex ItemDB graph (daily + average).
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Watchlist</h3>
        {watchlist.length === 0 ? (
          <p className="small" style={{ marginBottom: 0 }}>
            No watched items yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {watchlist.map((w) => (
              <div key={`${w.game}:${w.id}`} className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <b style={{ textTransform: "uppercase", fontSize: 12, opacity: 0.8 }}>{w.game}</b>{" "}
                  <span style={{ opacity: 0.8 }}>#{w.id}</span> {w.name ? <span>— {w.name}</span> : null}
                </div>

                <div className="row">
                  <button
                    type="button"
                    onClick={() => {
                      setGame(w.game);
                      setId(w.id);
                      setDetail(null);
                      setGraph(null);
                      setErr("");
                      setQ("");
                      setSearchResults([]);
                      setShowResults(false);
                      setActiveIndex(-1);
                      load(w.game, w.id);
                    }}
                  >
                    View
                  </button>
                  <button type="button" onClick={() => setWatchlist(removeFromWatchlist(w.game, w.id))}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
