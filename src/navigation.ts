/** A list entry keeps its position until removed; newly opened tools prepend by timestamp. */
export function recordToolOpen<T extends { id: string; favorite: boolean; rank: number; lastOpened: number | null }>(entries: T[], id: string, now: number): T[] {
  const existing = entries.find(entry => entry.id === id);
  if (existing) return existing.lastOpened == null
    ? entries.map(entry => entry.id === id ? { ...entry, lastOpened: now } : entry)
    : entries;
  return [...entries, { id, favorite: false, rank: Math.max(-1, ...entries.map(entry => entry.rank)) + 1, lastOpened: now } as T];
}
