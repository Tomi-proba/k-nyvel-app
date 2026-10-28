/**
 * Cégexport ellenőrzése:  npm run export:check -- <cegexport.zip>
 *
 * Fájlonként összeveti a SHA-256 lenyomatot a csomag tartalomjegyzékével (manifest.json), és kiírja a
 * módosult, hiányzó, olvashatatlan vagy oda nem tartozó fájlokat. Kilépési kód: 0 rendben, 1 hiba.
 */
import { readFileSync } from "node:fs";
import { EXPORT_FILE_STATUS_LABELS, verifyExport } from "../packages/shared/src/export-archive";

const file = process.argv[2];
if (!file) {
  console.error("Használat: npm run export:check -- <cegexport.zip>");
  process.exit(1);
}
let bytes: Uint8Array;
try {
  bytes = new Uint8Array(readFileSync(file));
} catch {
  console.error(`HIBA: a fájl nem olvasható: ${file}`);
  process.exit(1);
}
const r = await verifyExport(bytes);
if (r.manifest) {
  console.log(`Cég: ${r.manifest.company.name} (${r.manifest.company.taxNumber})`);
  console.log(`Készült: ${r.manifest.generatedAt}, készítette: ${r.manifest.generatedBy}`);
  console.log(`A tartalomjegyzék lenyomata: ${r.manifest.sha256}`);
  console.log("(Ezt az audit naplóban a „Cégexport” bejegyzéshez vetheti össze.)\n");
}
for (const f of r.files) console.log(`${f.status === "OK" ? "  rendben " : "  HIBA    "} ${f.path}${f.status === "OK" ? "" : ` – ${EXPORT_FILE_STATUS_LABELS[f.status]}`}`);
for (const u of r.unexpected) console.log(`  HIBA     ${u} – nem szerepel a tartalomjegyzékben`);
for (const e of r.errors) console.log(`  HIBA     ${e}`);
console.log(r.ok ? "\nA csomag sértetlen." : "\nA csomag SÉRÜLT vagy módosult.");
process.exit(r.ok ? 0 : 1);
