import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHubClient, LINK_PATH, signedHeaders, todoMirrorHash, verifySignature, type ModuleTodo } from "@konyvelo/esemenyek";
import { mirrorTodosOnce } from "../src/modules/integration/mirror";
import { createCompany, createTestApp, login, nextTaxNumber, ownerQuery, PASSWORD, resetDatabase, setupAdmin, type Client, type TestContext } from "./helpers";

/** Közös Teendők (I6, TERV.md F18): a Könyvelő Teendő-tükre és a többi program Teendői a Kezdőlapon. */

const SECRET = "teendo-teszt-titok-0123456789abcdef0123";
let ctx: TestContext;
let admin: Client;
let companyId: string;
const c = () => `/api/companies/${companyId}`;

const fakeHub = {
  server: null as Server | null,
  port: 0,
  calls: [] as Array<{ method: string; path: string; body: Record<string, unknown> }>,
  reply: null as null | ((method: string, path: string, body: Record<string, unknown>) => { status: number; body: unknown }),
};

beforeAll(async () => {
  await resetDatabase();
  fakeHub.server = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const check = verifySignature(req.headers, req.method!, req.url!, body, (s) => (s === "konyvelo" ? SECRET : null));
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (!check.ok) return send(401, { code: check.code, message: check.message });
      const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
      fakeHub.calls.push({ method: req.method!, path: req.url!, body: parsed });
      const r = fakeHub.reply?.(req.method!, req.url!, parsed) ?? { status: 404, body: { code: "NOT_FOUND", message: "nincs ilyen" } };
      send(r.status, r.body);
    });
  });
  await new Promise<void>((resolve) => fakeHub.server!.listen(0, "127.0.0.1", resolve));
  fakeHub.port = (fakeHub.server.address() as AddressInfo).port;
  ctx = await createTestApp({ hub: { url: `http://127.0.0.1:${fakeHub.port}`, secret: SECRET }, moduleUrls: { keszlet: "https://keszlet.example", eafa: null } });
  admin = await setupAdmin(ctx.app);
  const taxNumber = nextTaxNumber();
  companyId = (await createCompany(admin, { taxNumber })).id;
  await admin.post(`${c()}/fiscal-years`, { startDate: "2026-01-01", endDate: "2026-12-31" });
  const code = (await admin.post(`${c()}/integration/link-code`)).json().code as string;
  const text = JSON.stringify({ code, taxNumber });
  const linked = await ctx.app.inject({ method: "POST", url: LINK_PATH, headers: { "content-type": "application/json", ...signedHeaders(SECRET, "kozpont", "POST", LINK_PATH, text) }, payload: text });
  expect(linked.statusCode, linked.body).toBe(200);
});
afterAll(async () => {
  await ctx.close();
  fakeHub.server?.closeAllConnections();
  await new Promise((r) => fakeHub.server?.close(r));
});

describe("Teendő-tükör a központnak", () => {
  it("a Kezdőlap Teendői mennek, a más programok visszhangja nem; csak változáskor vagy a frissítési idő után küld", async () => {
    const acc = Object.fromEntries(((await admin.get(`${c()}/accounts`)).json() as Array<{ id: string; number: string }>).map((a) => [a.number, a.id]));
    const draft = await admin.post(`${c()}/documents`, {
      docType: "VEGY", description: "Piszkozat", issueDate: "2026-11-02", accountingDate: "2026-11-02",
      lines: [{ accountId: acc["522"], side: "D", amount: 1_000_00 }, { accountId: acc["454"], side: "C", amount: 1_000_00 }],
    });
    expect(draft.statusCode, draft.body).toBe(201);
    await ownerQuery(
      `INSERT INTO integration_todos (company_id, key, kind, title, document_id) VALUES
         ($1, 'p1', 'PURCHASE_APPROVAL', 'Jóváhagyásra vár: beszerzés', NULL),
         ($1, 'egy', 'RECONCILIATION', 'Készletérték: eltérés', NULL),
         ($1, 'afa', 'VAT_SELF_CHECK', 'Önellenőrzés szükséges lehet', NULL)`,
      [companyId],
    );
    fakeHub.calls = [];
    fakeHub.reply = (method, path) => (method === "PUT" && path === "/api/v1/modul/teendok" ? { status: 200, body: { stored: 1 } } : { status: 404, body: {} });
    const hub = createHubClient({ url: `http://127.0.0.1:${fakeHub.port}`, module: "konyvelo", secret: SECRET });
    const t0 = new Date("2026-11-02T08:00:00Z");
    expect(await mirrorTodosOnce(ctx.db, hub, t0)).toEqual({ sent: 1, unchanged: 0, failed: 0 });
    const sent = fakeHub.calls[0]!.body as { companyRef: string; todos: ModuleTodo[] };
    expect(sent.companyRef).toBe(companyId);
    const kinds = sent.todos.map((t) => t.kind);
    expect(kinds).toContain("PURCHASE_APPROVAL");
    expect(kinds).toContain("DRAFTS");
    expect(kinds).not.toContain("RECONCILIATION");
    expect(kinds).not.toContain("VAT_SELF_CHECK");
    expect(sent.todos.find((t) => t.kind === "PURCHASE_APPROVAL")!.link).toEqual({ module: "konyvelo", path: `/konyveles/jovahagyas?ceg=${companyId}` });
    expect(sent.todos.find((t) => t.kind === "DRAFTS")).toMatchObject({ title: "1 piszkozat vár könyvelésre", link: { module: "konyvelo", path: `/konyveles?ceg=${companyId}` } });
    for (const t of sent.todos) expect(t.link?.path).toContain(`ceg=${companyId}`);
    const stored = await ownerQuery("SELECT hash FROM integration_todo_mirror WHERE company_id = $1", [companyId]);
    expect(stored.rows[0]!.hash).toBe(todoMirrorHash(sent.todos));

    // Nem változott: nem küld; a frissítési idő után igen.
    expect(await mirrorTodosOnce(ctx.db, hub, new Date(t0.getTime() + 60_000))).toEqual({ sent: 0, unchanged: 1, failed: 0 });
    expect(await mirrorTodosOnce(ctx.db, hub, new Date(t0.getTime() + 11 * 60_000))).toEqual({ sent: 1, unchanged: 0, failed: 0 });
    // Változott (a Teendő megoldódott): azonnal küld, és a lista már nem tartalmazza.
    await ownerQuery("UPDATE integration_todos SET resolved_at = now() WHERE company_id = $1 AND key = 'p1'", [companyId]);
    expect((await mirrorTodosOnce(ctx.db, hub, new Date(t0.getTime() + 12 * 60_000))).sent).toBe(1);
    expect((fakeHub.calls.at(-1)!.body as { todos: ModuleTodo[] }).todos.map((t) => t.kind)).not.toContain("PURCHASE_APPROVAL");
    // A központ nem érhető el: hiba, a lenyomat nem frissül, a következő kör újrapróbálja.
    await ownerQuery("UPDATE integration_todos SET resolved_at = NULL WHERE company_id = $1 AND key = 'p1'", [companyId]);
    fakeHub.reply = () => ({ status: 503, body: { code: "DOWN", message: "nem érhető el" } });
    expect(await mirrorTodosOnce(ctx.db, hub, new Date(t0.getTime() + 13 * 60_000))).toEqual({ sent: 0, unchanged: 0, failed: 1 });
    fakeHub.reply = () => ({ status: 200, body: { stored: 1 } });
    expect((await mirrorTodosOnce(ctx.db, hub, new Date(t0.getTime() + 13 * 60_000 + 1))).sent).toBe(1);
  });
});

describe("a többi program Teendői a Kezdőlapon", () => {
  const answer = {
    todos: [
      { module: "keszlet", moduleLabel: "Készlet", key: "j1", kind: "JOVAHAGYAS", title: "Beérkezésre vár: 10 db ajtó", detail: "belső részlet", link: { module: "keszlet", path: "#/jovahagyasok" }, since: "2026-11-02T08:00:00.000Z" },
      { module: "eafa", moduleLabel: "eÁFA", key: "u1", kind: "UTOLAGOS_VALTOZAS", title: "Önellenőrzés szükséges lehet", detail: null, link: { module: "eafa", path: "#/ugyfel/1" }, since: null },
      { module: "kozpont", moduleLabel: "Integrációs központ", key: "atadas:keszlet", kind: "ATADASI_HIBA", title: "Átadási hiba", detail: null, link: null, since: null },
    ],
    modules: [
      { module: "keszlet", moduleLabel: "Készlet", mirroredAt: "2026-11-02T08:00:00.000Z" },
      { module: "konyvelo", moduleLabel: "Könyvelő", mirroredAt: "2026-11-02T08:00:00.000Z" },
    ],
  };

  it("az adminisztrátor a címet és a hivatkozást látja (a beállított programcímmel), a részletet nem", async () => {
    fakeHub.reply = (method, path) => (method === "GET" && path === `/api/v1/modul/teendok?companyRef=${companyId}` ? { status: 200, body: answer } : { status: 404, body: {} });
    const r = await admin.get(`${c()}/integration/shared-todos`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({
      state: "OK",
      todos: [
        { module: "keszlet", moduleLabel: "Készlet", title: "Beérkezésre vár: 10 db ajtó", url: "https://keszlet.example/#/jovahagyasok", since: "2026-11-02T08:00:00.000Z" },
        { module: "eafa", moduleLabel: "eÁFA", title: "Önellenőrzés szükséges lehet", url: null, since: null },
        { module: "kozpont", moduleLabel: "Integrációs központ", title: "Átadási hiba", url: null, since: null },
      ],
      modules: [{ moduleLabel: "Készlet", mirroredAt: "2026-11-02T08:00:00.000Z" }],
    });
    expect(r.body).not.toContain("belső részlet");
  });

  it("a könyvelő és a megtekintő nem látja; a központ kiesésekor érthető állapot", async () => {
    for (const [email, role] of [["kata@example.hu", "ACCOUNTANT"], ["vera@example.hu", "CHIEF_ACCOUNTANT"]] as const) {
      expect((await admin.post(`${c()}/members`, { email, name: email, role, initialPassword: PASSWORD })).statusCode).toBeLessThan(300);
    }
    const kata = await login(ctx.app, "kata@example.hu");
    expect((await kata.get(`${c()}/integration/shared-todos`)).json()).toEqual({ state: "NOT_ALLOWED", todos: [], modules: [] });
    const vera = await login(ctx.app, "vera@example.hu");
    expect((await vera.get(`${c()}/integration/shared-todos`)).json().state).toBe("OK");
    fakeHub.reply = () => ({ status: 503, body: { code: "DOWN", message: "nem érhető el" } });
    expect((await admin.get(`${c()}/integration/shared-todos`)).json()).toEqual({ state: "HUB_UNREACHABLE", todos: [], modules: [] });
  });
});
