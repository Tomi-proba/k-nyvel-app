// Futási mód (TERV.md F23 KB2): a Könyvelő önállóan (mint eddig) vagy a közös keretben fut. A keretben az
// útvonalai a /konyvelo, az API-ja a /api/konyvelo előtag alá kerül; önállóan minden pontosan a régi.

let utvonalElotag = "";
let apiElotag = "/api";

export function keretModBeallitas(utvonal: string, api: string) {
  utvonalElotag = utvonal.replace(/\/+$/, "");
  apiElotag = api.replace(/\/+$/, "");
}

export const keretben = () => utvonalElotag !== "";
export const alapUtvonal = () => utvonalElotag;

/** Egy Könyvelőn belüli abszolút útvonal (pl. /konyveles/12) a futási módnak megfelelően. */
export function ut(utvonal: string): string {
  if (!utvonalElotag || !utvonal.startsWith("/")) return utvonal;
  if (utvonal === utvonalElotag || utvonal.startsWith(`${utvonalElotag}/`) || utvonal.startsWith(`${utvonalElotag}?`)) return utvonal;
  if (utvonal === "/") return utvonalElotag;
  if (utvonal.startsWith("/?") || utvonal.startsWith("/#")) return `${utvonalElotag}${utvonal.slice(1)}`;
  return `${utvonalElotag}${utvonal}`;
}

/** Az API-cím a futási módnak megfelelően (/api/... → /api/konyvelo/... a keretben). */
export function apiCim(cim: string): string {
  return cim.startsWith("/api/") ? `${apiElotag}${cim.slice(4)}` : cim;
}

/** A keretbeli útvonalból a Könyvelő saját útvonala (pl. /konyvelo/zaras → /zaras). */
export function sajatUtvonal(pathname: string): string {
  if (!utvonalElotag || !pathname.startsWith(utvonalElotag)) return pathname;
  return pathname.slice(utvonalElotag.length) || "/";
}
