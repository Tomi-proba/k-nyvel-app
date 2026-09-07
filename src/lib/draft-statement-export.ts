import path from "node:path";
import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import type { DraftIncomeStatement } from "@/lib/draft-statement";
import { DRAFT_STATEMENT_DISCLAIMER, DRAFT_STATEMENT_WATERMARK } from "@/lib/legal-disclaimer";

const FONT_REGULAR = path.join(process.cwd(), "src/lib/fonts/IBMPlexSans-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "src/lib/fonts/IBMPlexSans-Bold.ttf");

const huCurrency = new Intl.NumberFormat("hu-HU", {
  style: "currency",
  currency: "HUF",
  maximumFractionDigits: 0,
});

/* ==============================================================
 * PDF
 *
 * pdfkit kritikus tulajdonsága, ami sok elrejtett hibaforrás oka lehet:
 * `.text(str, x, y, opts)` explicit koordinátákkal is TOVÁBBRA IS
 * elmozdítja a belső `doc.y`-t, és `.save()/.restore()` NEM állítja
 * vissza a font/fontSize-t (csak a grafikai állapotot: szín, transzformáció,
 * opacitás) — ezért itt egyáltalán nem hagyatkozunk a `doc.y` implicit
 * követésére vagy a `moveDown()`-ra. Egyetlen, általunk kézzel vezetett
 * `cursor.y` értéket használunk, minden szövegblokk magasságát előre
 * megmérjük (`heightOfString`), és mi magunk döntjük el, mikor kell új
 * oldalt kezdeni — így nincs meglepetés-lapozás vagy elcsúszott pozíció.
 * ============================================================== */

type Cursor = { y: number };

/**
 * Fenntartott hely a lábjegyzetnek (vízjel-szöveg + generálás dátuma) minden
 * oldal alján. FONTOS: pdfkit a `.text()` hívásoknál a `page.margins.bottom`
 * alapján SAJÁT MAGA is automatikus új oldalt indíthat, akkor is, ha explicit
 * x/y koordinátát adunk meg — ezért a lábjegyzetet szándékosan e fölé a
 * "tartalmi" határ fölé, de a valódi (kicsi) PDF margón belülre helyezzük,
 * hogy se a mi `ensureSpace`, se pdfkit belső ellenőrzése ne indítson emiatt
 * felesleges üres oldalt.
 */
const FOOTER_ZONE_HEIGHT = 46;

function metrics(doc: PDFKit.PDFDocument) {
  return {
    left: doc.page.margins.left,
    right: doc.page.width - doc.page.margins.right,
    top: doc.page.margins.top,
    bottom: doc.page.height - doc.page.margins.bottom - FOOTER_ZONE_HEIGHT,
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  };
}

function ensureSpace(doc: PDFKit.PDFDocument, cursor: Cursor, needed: number) {
  const { bottom, top } = metrics(doc);
  if (cursor.y + needed > bottom) {
    doc.addPage();
    cursor.y = top;
  }
}

function drawBlock(
  doc: PDFKit.PDFDocument,
  cursor: Cursor,
  text: string,
  opts: { font: "Body" | "Bold"; size: number; color: string; gapAfter?: number; width?: number }
) {
  const { left, width } = metrics(doc);
  const w = opts.width ?? width;
  doc.font(opts.font).fontSize(opts.size);
  const h = doc.heightOfString(text, { width: w });
  ensureSpace(doc, cursor, h + (opts.gapAfter ?? 0));
  doc.fillColor(opts.color).text(text, left, cursor.y, { width: w });
  cursor.y += h + (opts.gapAfter ?? 0);
}

/** Egy sor: bal oldalt kategórianév, jobbra igazítva az összeg — azonos "y"-on. */
function drawRow(
  doc: PDFKit.PDFDocument,
  cursor: Cursor,
  label: string,
  amount: string,
  opts: { font: "Body" | "Bold"; size: number; color: string; gapAfter?: number }
) {
  const { left, right, width } = metrics(doc);
  const labelWidth = width * 0.62;
  doc.font(opts.font).fontSize(opts.size);
  const h = Math.max(
    doc.heightOfString(label, { width: labelWidth }),
    doc.heightOfString(amount, { width: width - labelWidth })
  );
  ensureSpace(doc, cursor, h + (opts.gapAfter ?? 0));
  doc.fillColor(opts.color);
  doc.text(label, left, cursor.y, { width: labelWidth });
  doc.text(amount, left + labelWidth, cursor.y, { width: right - left - labelWidth, align: "right" });
  cursor.y += h + (opts.gapAfter ?? 0);
}

function drawDisclaimerBox(doc: PDFKit.PDFDocument, cursor: Cursor) {
  const { left, width } = metrics(doc);
  const innerWidth = width - 20;

  doc.font("Bold").fontSize(9);
  const headingHeight = doc.heightOfString("TERVEZET — NEM HIVATALOS DOKUMENTUM", { width: innerWidth });
  doc.font("Body").fontSize(9);
  const bodyHeight = doc.heightOfString(DRAFT_STATEMENT_DISCLAIMER, { width: innerWidth });
  const boxHeight = headingHeight + bodyHeight + 24;

  ensureSpace(doc, cursor, boxHeight + 18);
  const startY = cursor.y;

  doc.save();
  doc.lineWidth(1.5);
  doc.roundedRect(left, startY, width, boxHeight, 6).fillAndStroke("#fffbeb", "#d97706");
  doc.restore();

  doc.fillColor("#78350f").font("Bold").fontSize(9);
  doc.text("TERVEZET — NEM HIVATALOS DOKUMENTUM", left + 10, startY + 10, { width: innerWidth });
  doc.fillColor("#78350f").font("Body").fontSize(9);
  doc.text(DRAFT_STATEMENT_DISCLAIMER, left + 10, startY + 10 + headingHeight + 4, { width: innerWidth });

  cursor.y = startY + boxHeight + 18;
}

function drawStatementSection(
  doc: PDFKit.PDFDocument,
  cursor: Cursor,
  title: string,
  lines: { categoryName: string; net: number }[],
  total: number
) {
  const { left, right } = metrics(doc);

  drawBlock(doc, cursor, title, { font: "Bold", size: 11, color: "#000000", gapAfter: 6 });

  if (lines.length === 0) {
    drawBlock(doc, cursor, "Nincs jóváhagyott tétel ebben az időszakban.", {
      font: "Body",
      size: 9,
      color: "#64748b",
      gapAfter: 4,
    });
  } else {
    for (const line of lines) {
      drawRow(doc, cursor, line.categoryName, huCurrency.format(line.net), {
        font: "Body",
        size: 9.5,
        color: "#1e293b",
        gapAfter: 4,
      });
    }
  }

  ensureSpace(doc, cursor, 10);
  doc.save();
  doc.moveTo(left, cursor.y).lineTo(right, cursor.y).lineWidth(0.75).strokeColor("#cbd5e1").stroke();
  doc.restore();
  cursor.y += 10;

  drawRow(doc, cursor, `${title} összesen`, huCurrency.format(total), {
    font: "Bold",
    size: 10,
    color: "#000000",
    gapAfter: 18,
  });
}

function drawResultBox(doc: PDFKit.PDFDocument, cursor: Cursor, result: number) {
  const { left, right, width } = metrics(doc);
  const boxHeight = 34;
  ensureSpace(doc, cursor, boxHeight + 18);

  doc.save();
  doc.rect(left, cursor.y, width, boxHeight).fill("#f1f5f9");
  doc.restore();

  const textY = cursor.y + (boxHeight - 13) / 2;
  doc.fillColor("#0f172a").font("Bold").fontSize(11.5);
  doc.text("Tervezett eredmény (bevétel − kiadás)", left + 10, textY, { width: width * 0.55 });
  doc.text(huCurrency.format(result), left, textY, { width: right - left - 10, align: "right" });

  cursor.y += boxHeight + 18;
}

function drawPageDecorations(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const { left, width, bottom } = metrics(doc);

    doc.save();
    doc.rotate(-40, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.opacity(0.09);
    doc.font("Bold").fontSize(58).fillColor("#7c2d12");
    doc.text(DRAFT_STATEMENT_WATERMARK, -100, doc.page.height / 2 - 30, {
      width: doc.page.width + 200,
      align: "center",
    });
    doc.opacity(1);
    doc.restore();

    doc.font("Body").fontSize(7.5).fillColor("#94a3b8");
    doc.text(
      `TERVEZET – nem hivatalos dokumentum. Generálva: ${new Date().toLocaleString("hu-HU")}`,
      left,
      bottom + 16,
      { width, align: "center" }
    );
  }
}

export function buildDraftStatementPdf(data: {
  companyName: string;
  statement: DraftIncomeStatement;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("Body", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);

    const cursor: Cursor = { y: doc.page.margins.top };

    drawBlock(doc, cursor, "Tervezet eredménykimutatás", { font: "Bold", size: 17, color: "#000000", gapAfter: 2 });
    drawBlock(doc, cursor, `${data.companyName} — ${data.statement.periodLabel}`, {
      font: "Body",
      size: 10,
      color: "#475569",
      gapAfter: 14,
    });

    drawDisclaimerBox(doc, cursor);

    drawBlock(
      doc,
      cursor,
      "A táblázat nettó (ÁFA nélküli) összegeket mutat, mert az ÁFA gazdaságilag nem saját bevétel/kiadás. " +
        "A számítás nem tartalmaz écs-elszámolást, időbeli elhatárolást vagy egyéb összetett számviteli korrekciót.",
      { font: "Body", size: 9, color: "#475569", gapAfter: 16 }
    );

    drawStatementSection(doc, cursor, "Bevételek", data.statement.incomeLines, data.statement.incomeTotal);
    drawStatementSection(doc, cursor, "Ráfordítások", data.statement.expenseLines, data.statement.expenseTotal);

    drawResultBox(doc, cursor, data.statement.estimatedResult);

    drawBlock(doc, cursor, `${data.statement.includedInvoiceCount} jóváhagyott bizonylat alapján.`, {
      font: "Body",
      size: 8.5,
      color: "#94a3b8",
      gapAfter: 14,
    });

    if (data.statement.excludedNotConfirmedCount > 0) {
      drawBlock(
        doc,
        cursor,
        `Megjegyzés: ${data.statement.excludedNotConfirmedCount} bizonylat még ellenőrzésre vár ebben az ` +
          "időszakban, ezek adatait a rendszer nem tekinti megbízhatónak, ezért nem szerepelnek a fenti tervezetben.",
        { font: "Body", size: 9, color: "#b45309", gapAfter: 16 }
      );
    }

    drawBlock(doc, cursor, "Mérleg-vázlat", { font: "Bold", size: 9.5, color: "#1e293b", gapAfter: 4 });
    drawBlock(
      doc,
      cursor,
      "A rendszer jelenleg nem tárol elég strukturált adatot (pl. eszköz-/kötelezettség-kategóriák, " +
        "bankegyenleg, kintlévőségek) egy mérleg-becsléshez, ezért ez a szakasz egyelőre kimarad.",
      { font: "Body", size: 9, color: "#475569" }
    );

    drawPageDecorations(doc);
    doc.end();
  });
}

/* ============================== XLSX ============================== */

export function buildDraftStatementXlsx(data: { companyName: string; statement: DraftIncomeStatement }): Buffer {
  const s = data.statement;
  const rows: (string | number)[][] = [
    ["*** TERVEZET — NEM HIVATALOS DOKUMENTUM ***"],
    [DRAFT_STATEMENT_DISCLAIMER],
    [],
    [`${data.companyName} — Tervezet eredménykimutatás — ${s.periodLabel}`],
    ["Nettó (ÁFA nélküli) összegek, écs-elszámolás és időbeli elhatárolás nélkül."],
    [],
    ["Bevételek", ""],
    ...s.incomeLines.map((l) => [l.categoryName, l.net]),
    ["Bevételek összesen", s.incomeTotal],
    [],
    ["Ráfordítások", ""],
    ...s.expenseLines.map((l) => [l.categoryName, l.net]),
    ["Ráfordítások összesen", s.expenseTotal],
    [],
    ["Tervezett eredmény (bevétel − kiadás)", s.estimatedResult],
    [],
  ];

  if (s.excludedNotConfirmedCount > 0) {
    rows.push([
      `Megjegyzés: ${s.excludedNotConfirmedCount} bizonylat még ellenőrzésre vár ebben az időszakban, ezek nem szerepelnek a tervezetben.`,
    ]);
    rows.push([]);
  }

  rows.push([
    "Mérleg-vázlat: a rendszer jelenleg nem tárol elég strukturált adatot (eszköz-/kötelezettség-kategóriák, " +
      "bankegyenleg, kintlévőségek) egy mérleg-becsléshez, ezért ez a szakasz egyelőre kimarad.",
  ]);
  rows.push([]);
  rows.push([DRAFT_STATEMENT_WATERMARK]);

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 46 }, { wch: 18 }];
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 1 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 1 } },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Tervezet kimutatás");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
