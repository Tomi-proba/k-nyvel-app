// F29: valós idejű frissítés. A cég minden (auditált) változásáról adat nélküli jelzés megy a cég nyitott
// kapcsolataira; csak az kapja, aki a céget láthatja; a visszagörgetett módosításról nem megy jelzés; a kapcsolat nem
// hosszabbítja a munkamenetet.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, PASSWORD, appQuery, createCompany, createTestApp, login, resetDatabase, setupAdmin, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: Client;
let cim: string;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestApp();
  admin = await setupAdmin(ctx.app);
  await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const a = ctx.app.server.address();
  cim = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => ctx.close());

/** Nyitott SSE-kapcsolat: a beérkezett események listája, és a lezárás. */
async function figyel(kliens: Client | null, companyId: string) {
  const vezerlo = new AbortController();
  const res = await fetch(`${cim}/api/companies/${companyId}/elo`, {
    headers: kliens?.suti ? { cookie: kliens.suti } : {},
    signal: vezerlo.signal,
  });
  const esemenyek: { event: string; data: string }[] = [];
  if (res.ok && res.body) {
    const olvaso = res.body.getReader();
    const dekoder = new TextDecoder();
    let puffer = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await olvaso.read();
          if (done) return;
          puffer += dekoder.decode(value, { stream: true });
          let i: number;
          while ((i = puffer.indexOf("\n\n")) >= 0) {
            const blokk = puffer.slice(0, i);
            puffer = puffer.slice(i + 2);
            const event = /^event: (.*)$/m.exec(blokk)?.[1];
            const data = /^data: (.*)$/m.exec(blokk)?.[1];
            if (event) esemenyek.push({ event, data: data ?? "" });
          }
        }
      } catch {
        /* lezárva */
      }
    })();
  }
  return { res, esemenyek, zar: () => vezerlo.abort() };
}

async function var_(feltetel: () => boolean, ms = 3000): Promise<void> {
  const vege = Date.now() + ms;
  while (!feltetel()) {
    if (Date.now() > vege) throw new Error("Időtúllépés");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("élő frissítés (F29)", () => {
  it("a cég változásáról jelzés megy, adat nélkül; a másik cég változásáról nem", async () => {
    const a = await createCompany(admin);
    const b = await createCompany(admin);
    const f = await figyel(admin, a.id);
    expect(f.res.status).toBe(200);
    expect(f.res.headers.get("content-type")).toMatch(/text\/event-stream/);
    await var_(() => f.esemenyek.some((e) => e.event === "kapcsolodva"));
    await ctx.app.eloEloszto.kesz();

    await admin.patch(`/api/companies/${b.id}`, { addressCity: "Pécs" });
    await admin.patch(`/api/companies/${a.id}`, { addressCity: "Debrecen" });
    await var_(() => f.esemenyek.some((e) => e.event === "valtozas"));
    const valtozasok = f.esemenyek.filter((e) => e.event === "valtozas");
    expect(valtozasok).toEqual([{ event: "valtozas", data: JSON.stringify({ fajta: "company" }) }]);
    // Adatot (pl. a várost) nem küld.
    expect(JSON.stringify(f.esemenyek)).not.toMatch(/Debrecen|Pécs/);
    f.zar();
    await var_(() => ctx.app.eloEloszto.feliratkozok === 0);
  });

  it("csak az kapja, aki a céget láthatja", async () => {
    const a = await createCompany(admin);
    const b = await createCompany(admin);
    await admin.post(`/api/companies/${b.id}/members`, { email: "elo-kulso@example.hu", name: "Külső Károly", role: "VIEWER", initialPassword: PASSWORD });
    const kulso = await login(ctx.app, "elo-kulso@example.hu");

    expect((await figyel(null, a.id)).res.status).toBe(401);
    const idegen = await figyel(kulso, a.id);
    expect(idegen.res.status).toBe(404);
    const sajat = await figyel(kulso, b.id);
    expect(sajat.res.status).toBe(200);
    sajat.zar();
  });

  it("visszagörgetett módosításról nem megy jelzés", async () => {
    const a = await createCompany(admin);
    const f = await figyel(admin, a.id);
    await var_(() => f.esemenyek.some((e) => e.event === "kapcsolodva"));
    await ctx.app.eloEloszto.kesz();
    await appQuery(`BEGIN; SELECT pg_notify('konyvelo_valtozas', '{"c":"${a.id}","f":"proba"}'); ROLLBACK;`);
    await admin.patch(`/api/companies/${a.id}`, { addressCity: "Szeged" });
    await var_(() => f.esemenyek.some((e) => e.event === "valtozas"));
    expect(f.esemenyek.filter((e) => e.event === "valtozas").map((e) => JSON.parse(e.data).fajta)).toEqual(["company"]);
    f.zar();
  });

  it("a kapcsolat és az automatikus újratöltés nem hosszabbítja a munkamenetet", async () => {
    const a = await createCompany(admin);
    const regi = new Date(Date.now() - 10 * 60_000);
    await appQuery("UPDATE sessions SET last_seen_at = $1", [regi]);
    const f = await figyel(admin, a.id);
    expect(f.res.status).toBe(200);
    f.zar();
    await admin.request("GET", `/api/companies/${a.id}`, undefined, { "x-konyvelo-automatikus": "1" });
    const { rows } = await appQuery("SELECT last_seen_at FROM sessions ORDER BY last_seen_at DESC LIMIT 1");
    expect(new Date(rows[0].last_seen_at).getTime()).toBe(regi.getTime());
    // A felhasználó saját kérése igen.
    await admin.get(`/api/companies/${a.id}`);
    const utana = await appQuery("SELECT max(last_seen_at) AS m FROM sessions");
    expect(new Date(utana.rows[0].m).getTime()).toBeGreaterThan(regi.getTime());
  });
});
