import type { PlayerRecord } from "../train/playerProfile";

const KEY = "lhitl2.playerRecords";
const MAX = 200;

/** Aufgezeichnete eigene Partien (lokal im Browser). Fehlertolerant: ohne Storage läuft das Spiel trotzdem. */
export function loadPlayerRecords(): PlayerRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlayerRecord[]) : [];
  } catch {
    return [];
  }
}

export function savePlayerRecord(record: PlayerRecord): void {
  try {
    const all = [...loadPlayerRecords(), record].slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* Storage nicht verfügbar */
  }
}

export function clearPlayerRecords(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignorieren */
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
