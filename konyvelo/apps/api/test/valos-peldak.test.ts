import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, createCompany, createTestApp, nextTaxNumber, ownerQuery, resetDatabase, setupAdmin, type TestContext } from "./helpers";

/**
 * Öt valós gazdasági esemény és egy sztornó, mindkét sztornómóddal.
 * Ellenőrzi a számlák egyenlegét és forgalmát a könyvelés után.
 */
let ctx: TestContext;
let admin: Client;
beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
});
afterAll(async () => ctx.close());

const ft = (n: number) => n * 100;

async function scenario(reversalMethod: "SWAP" | "NEGATIVE") {
  const c = (await createCompany(admin, { reversalMethod })).id;
  await admin.post(`/api/companies/${c}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  const acc: Record<string, string> = Object.fromEntries(
    ((await admin.get(`/api/companies/${c}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]),
  );
  const supplier = (await admin.post(`/api/companies/${c}/partners`, { kind: "SUPPLIER", name: "Irodaház Kft.", taxNumber: nextTaxNumber() })).json().id;
  const customer = (await admin.post(`/api/companies/${c}/partners`, { kind: "CUSTOMER", name: "Ügyfél Zrt.", taxNumber: nextTaxNumber() })).json().id;
  const L = (n: string, side: "D" | "C", amount: number) => ({ accountId: acc[n], side, amount: ft(amount) });
  const post = async (body: Record<string, unknown>) => {
    const r = await admin.post(`/api/companies/${c}/documents`, { ...body, post: true });
    expect(r.statusCode, r.body).toBe(201);
    return r.json();
  };
  const rent = (externalNumber: string) => ({
    docType: "SZSZ", partnerId: supplier, externalNumber, description: "Irodabérlet, október",
    issueDate: "2026-10-01", fulfillmentDate: "2026-10-01", accountingDate: "2026-10-01",
    lines: [L("522", "D", 100000), L("466", "D", 27000), L("454", "C", 127000)],
  });

  // 1. Szállítói számla: irodabérlet 100 000 + 27% áfa.
  await post(rent("IH-2026/101"));
  // 2. Vevőszámla: szolgáltatás 200 000 + 27% áfa.
  await post({
    docType: "VSZ", partnerId: customer, externalNumber: "2026/0001", description: "Tanácsadás, október",
    issueDate: "2026-10-05", fulfillmentDate: "2026-10-05", accountingDate: "2026-10-05",
    lines: [L("311", "D", 254000), L("912", "C", 200000), L("467", "C", 54000)],
  });
  // 3. Banki kifizetés a szállítónak.
  await post({ docType: "BANK", partnerId: supplier, description: "Kifizetés IH-2026/101", issueDate: "2026-10-10", accountingDate: "2026-10-10",
    lines: [L("454", "D", 127000), L("384", "C", 127000)] });
  // 4. A vevő átutalása.
  await post({ docType: "BANK", partnerId: customer, description: "Jóváírás 2026/0001", issueDate: "2026-10-15", accountingDate: "2026-10-15",
    lines: [L("384", "D", 254000), L("311", "C", 254000)] });
  // 5. Bankköltség (áfamentes).
  await post({ docType: "BANK", description: "Számlavezetési díj, október", issueDate: "2026-10-31", accountingDate: "2026-10-31",
    lines: [L("532", "D", 2350), L("384", "C", 2350)] });
  // Hiba: ugyanazt a szállítói számlát kétszer rögzítették → sztornó.
  const dup = await post(rent("IH-2026/101 (dupla)"));
  const s = await admin.post(`/api/companies/${c}/documents/${dup.id}/reverse`, { accountingDate: "2026-10-02", reason: "Kétszer rögzítve" });
  expect(s.statusCode, s.body).toBe(201);

  const rows = (
    await ownerQuery(
      `SELECT a.number, sum(l.amount) FILTER (WHERE l.side = 'D') AS d, sum(l.amount) FILTER (WHERE l.side = 'C') AS k
         FROM journal_lines l JOIN documents doc ON doc.id = l.document_id JOIN accounts a ON a.id = l.account_id
        WHERE doc.company_id = $1 AND doc.status = 'POSTED' GROUP BY a.number ORDER BY a.number`,
      [c],
    )
  ).rows as Array<{ number: string; d: string | null; k: string | null }>;
  return Object.fromEntries(rows.map((r) => [r.number, { forgalomT: Number(r.d ?? 0) / 100, forgalomK: Number(r.k ?? 0) / 100, egyenleg: (Number(r.d ?? 0) - Number(r.k ?? 0)) / 100 }]));
}

/** Egyenleg: pozitív = tartozik, negatív = követel. A sztornó után a dupla számla nyoma eltűnik. */
const EXPECTED_BALANCE = { "311": 0, "384": 124650, "454": 0, "466": 27000, "467": -54000, "522": 100000, "532": 2350, "912": -200000 };

describe("öt valós példa + sztornó", () => {
  it("fordított oldalas sztornó: helyes egyenlegek, a forgalom a sztornóval nő", async () => {
    const r = await scenario("SWAP");
    expect(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.egyenleg]))).toEqual(EXPECTED_BALANCE);
    expect(r["454"]).toEqual({ forgalomT: 254000, forgalomK: 254000, egyenleg: 0 });
    expect(r["522"]).toEqual({ forgalomT: 200000, forgalomK: 100000, egyenleg: 100000 });
  });

  it("negatív előjeles sztornó: ugyanazok az egyenlegek, a forgalom nem nő", async () => {
    const r = await scenario("NEGATIVE");
    expect(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.egyenleg]))).toEqual(EXPECTED_BALANCE);
    expect(r["454"]).toEqual({ forgalomT: 127000, forgalomK: 127000, egyenleg: 0 });
    expect(r["522"]).toEqual({ forgalomT: 100000, forgalomK: 0, egyenleg: 100000 });
  });
});
