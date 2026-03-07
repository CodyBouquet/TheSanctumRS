export const BASES = {
  rs3: "https://services.runescape.com/m=itemdb_rs",
  osrs: "https://services.runescape.com/m=itemdb_oldschool",
};

export function normalizeGame(game) {
  const g = (game || "rs3").toLowerCase();
  return g === "osrs" ? "osrs" : "rs3";
}
