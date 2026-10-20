/**
 * Kanonikus JSON: a kulcsok ABC-sorrendben, szóköz nélkül. Ugyanabból az
 * adatból mindig ugyanaz a szöveg készül, ezért hash-elhető (audit napló,
 * bizonylat tartalmi lenyomata).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Nem véges szám nem kerülhet kanonikus JSON-ba.");
    }
    if (typeof value === "bigint") return value.toString();
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJson(v === undefined ? null : v)).join(",") + "]";
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}
