/**
 * A Könyvelő felületén belüli útvonal a cég kiválasztásával (`?ceg=`, TERV.md F18): a másik programból vagy
 * a közös Kezdőlapról nyitott hivatkozás így mindig a jó cégnél nyílik meg (ha a felhasználónak van hozzá
 * hozzáférése). Ami már tartalmazza, vagy nem a Könyvelőn belüli útvonal, változatlan marad.
 */
export function konyveloPath(companyId: string, path: string): string {
  if (!path.startsWith("/") || /[?&]ceg=/.test(path)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}ceg=${companyId}`;
}
