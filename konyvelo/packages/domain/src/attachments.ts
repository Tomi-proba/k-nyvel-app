/**
 * Csatolmányok (K9): a fájl típusát a TARTALMA alapján döntjük el (a fájl eleji „bűvös bájtok”), és a
 * kiterjesztésnek is egyeznie kell vele. Csak PDF, JPEG és PNG fogadható el.
 */

export type AttachmentType = "application/pdf" | "image/jpeg" | "image/png";

export const ATTACHMENT_TYPES: Record<AttachmentType, { label: string; extensions: readonly string[] }> = {
  "application/pdf": { label: "PDF", extensions: ["pdf"] },
  "image/jpeg": { label: "JPEG-kép", extensions: ["jpg", "jpeg"] },
  "image/png": { label: "PNG-kép", extensions: ["png"] },
};

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0) => b.length >= offset + sig.length && sig.every((x, i) => b[offset + i] === x);

/** A fájl típusa a tartalma szerint, vagy `null`, ha egyik elfogadott sem. */
export function detectAttachmentType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

export type AttachmentCheck = { ok: true; type: AttachmentType; fileName: string } | { ok: false; message: string };

/** A feltöltött fájl ellenőrzése: név, méret, tartalom szerinti típus és a kiterjesztés egyezése. */
export function checkAttachment(fileName: string, bytes: Uint8Array, maxBytes: number): AttachmentCheck {
  const name = fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, 255);
  if (!name) return { ok: false, message: "A fájlnak nincs neve." };
  if (bytes.length === 0) return { ok: false, message: "A fájl üres." };
  if (bytes.length > maxBytes) {
    return { ok: false, message: `A fájl túl nagy (${(bytes.length / 1024 / 1024).toFixed(1)} MB); legfeljebb ${+(maxBytes / 1024 / 1024).toFixed(1)} MB tölthető fel.` };
  }
  const type = detectAttachmentType(bytes);
  if (!type) return { ok: false, message: "Csak PDF, JPEG vagy PNG fájl tölthető fel (a fájl tartalma alapján egyik sem)." };
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!ATTACHMENT_TYPES[type].extensions.includes(ext)) {
    return { ok: false, message: `A fájl tartalma ${ATTACHMENT_TYPES[type].label}, de a kiterjesztése „.${ext || "(nincs)"}”. Nevezze át, vagy válassza a megfelelő fájlt.` };
  }
  return { ok: true, type, fileName: name };
}
