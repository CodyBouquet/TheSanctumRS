const KEY = "ge_watchlist_v1";

export function loadWatchlist() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(items) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
}

/**
 * Item shape:
 * { game: "rs3"|"osrs", id: "4151", name?: "Abyssal whip" }
 */
export function addToWatchlist(item) {
  const list = loadWatchlist();
  const exists = list.some((x) => x.game === item.game && x.id === item.id);
  if (exists) return list;
  const next = [{ ...item }, ...list].slice(0, 50);
  saveWatchlist(next);
  return next;
}

export function removeFromWatchlist(game, id) {
  const list = loadWatchlist();
  const next = list.filter((x) => !(x.game === game && x.id === id));
  saveWatchlist(next);
  return next;
}
