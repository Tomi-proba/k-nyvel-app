import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { addDays, formatHuf, normalizeForSearch, parseBalancePaste, parseOpenItemsPaste, todayIso } from "@konyvelo/domain";
import type { ClosingStatusDto } from "@konyvelo/shared";
import { fiscalYearsKey, useWorkspace } from "../../app/workspace";
import { ApiError, get, post } from "../../lib/api";
import { fiscalYearLabel, formatDateHu, formatDateTimeHu } from "../../lib/format";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DateInput } from "../../ui/DateInput";
import { Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { useAccounts } from "../accounts/useAccounts";
import { useInvalidateDocuments } from "../documents/queries";
import { usePartners } from "../partners/usePartners";
import { SubNav } from "../subledger/SubledgerPages";

const TABS = [
  { to: "/zaras", label: "Időszakok és évzárás", end: true },
  { to: "/zaras/nyitas", label: "Nyitó egyenlegek" },
];

const YEAR_STATUS: Record<ClosingStatusDto["fiscalYear"]["status"], string> = { OPEN: "Nyitott", CLOSING: "Zárlati állapot", CLOSED: "Lezárt" };

/** Megerősítő ablak indoklással (feloldás, újranyitás). */
function ReasonDialog({ trigger, title, description, confirmLabel, onConfirm }: { trigger: ReactNode; title: string; description: ReactNode; confirmLabel: string; onConfirm: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setReason("");
        setError(null);
      }}
    >
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog">
          <AlertDialog.Title asChild>
            <h2>{title}</h2>
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div>{description}</div>
          </AlertDialog.Description>
          <Field label="Indoklás" required error={error ?? undefined}>
            {(p) => <input {...p} type="text" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div className="dialog-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="btn">
                Mégse
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className="btn btn-danger-solid"
              onClick={async () => {
                try {
                  await onConfirm(reason);
                  setOpen(false);
                } catch (err) {
                  setError(err instanceof ApiError ? (err.fields.reason ?? err.message) : "Váratlan hiba történt.");
                }
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function ClosingPage() {
  const ws = useWorkspace();
  const toast = useToast();
  const queryClient = useQueryClient();
  const invalidateDocs = useInvalidateDocuments();
  const fy = ws.fiscalYear;
  const companyId = ws.company?.id;
  const key = ["closing", companyId, fy?.id];
  const q = useQuery({ queryKey: key, queryFn: () => get<ClosingStatusDto>(`/api/companies/${companyId}/fiscal-years/${fy!.id}/closing`), enabled: Boolean(companyId && fy) });
  const [confirmName, setConfirmName] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ["closing", companyId] }), queryClient.invalidateQueries({ queryKey: fiscalYearsKey(companyId ?? null) }), queryClient.invalidateQueries({ queryKey: ["reports", companyId] }), invalidateDocs()]);
  const act = async (path: string, body: unknown, ok: string) => {
    try {
      await post(`/api/companies/${companyId}/${path}`, body);
      await refresh();
      toast("success", ok);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Váratlan hiba történt.");
      throw err;
    }
  };

  if (!fy) {
    return (
      <>
        <SubNav label="Zárás almenü" items={TABS} />
        <PageHeader title="Zárás" />
        <p>Nincs kiválasztott üzleti év.</p>
      </>
    );
  }
  const d = q.data;
  const canClose = ws.can("period:close");
  const canReopen = ws.can("period:reopen");
  const checks = d
    ? [
        { ok: d.drafts === 0, text: d.drafts === 0 ? "Nincs piszkozat az üzleti évben." : `${d.drafts} piszkozat van az üzleti évben – könyvelje vagy törölje őket.`, link: d.drafts ? "/konyveles?allapot=piszkozat" : null },
        {
          ok: d.reconciliationDifferences.length === 0,
          text: d.reconciliationDifferences.length === 0 ? "A főkönyv és az analitika egyezik a fordulónapon." : `Főkönyv–analitika eltérés: ${d.reconciliationDifferences.map((r) => `${r.accountNumber} (${formatHuf(r.difference)})`).join(", ")}.`,
          link: "/partnerek/egyeztetes",
        },
        { ok: d.missingAccounts.length === 0, text: d.missingAccounts.length === 0 ? "A zárási számlák (491, 493, 419, 413) megvannak." : `Hiányzó zárási számlák: ${d.missingAccounts.join(", ")}.`, link: d.missingAccounts.length ? "/beallitasok/szamlatukor" : null },
        { ok: Boolean(d.nextFiscalYear), text: d.nextFiscalYear ? `A következő üzleti év (${fiscalYearLabel(d.nextFiscalYear)}) létezik; a nyitás oda kerül.` : "Hozza létre a következő üzleti évet (a nyitáshoz kell).", link: d.nextFiscalYear ? null : "/beallitasok/uzleti-evek" },
      ]
    : [];

  return (
    <>
      <SubNav label="Zárás almenü" items={TABS} />
      <PageHeader
        title="Időszakok és évzárás"
        description={`${fiscalYearLabel(fy)}. üzleti év. Lezárt időszakba nem lehet könyvelni; javítani a nyitott időszakban, helyesbítő tétellel lehet (Szt. 165. § (2)).`}
      />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <>
          <p>
            Állapot: <span className={`badge ${d.fiscalYear.status === "CLOSED" ? "badge-success" : d.fiscalYear.status === "CLOSING" ? "badge-warning" : ""}`}>{YEAR_STATUS[d.fiscalYear.status]}</span>
            {d.fiscalYear.closedAt && <> · lezárva: {formatDateTimeHu(d.fiscalYear.closedAt)}</>}
            {d.fiscalYear.retentionUntil && <> · megőrzési idő: {formatDateHu(d.fiscalYear.retentionUntil)}-ig (Szt. 169. §)</>}
          </p>
          <section className="card table-wrap" aria-labelledby="havi">
            <h2 id="havi">Havi időszakok</h2>
            <table>
              <thead>
                <tr>
                  <th scope="col">Időszak</th>
                  <th scope="col">Állapot</th>
                  <th scope="col">Piszkozatok</th>
                  <th scope="col">
                    <span className="sr-only">Művelet</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.periods.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>{p.status === "CLOSED" ? <span className="badge badge-success">Lezárt</span> : "Nyitott"}</td>
                    <td>{p.drafts > 0 ? <Link to="/konyveles?allapot=piszkozat">{p.drafts} piszkozat</Link> : ""}</td>
                    <td>
                      {d.fiscalYear.status !== "CLOSED" && p.status === "OPEN" && canClose && (
                        <ConfirmDialog
                          danger={false}
                          trigger={
                            <button type="button" className="btn btn-small" aria-label={`Lezárás: ${p.label}`}>
                              Lezárás
                            </button>
                          }
                          title={`${p.label} lezárása`}
                          description={<p>Lezárás után ebbe az időszakba nem lehet könyvelni. Feloldani csak Adminisztrátor tudja, indoklással; a feloldás az audit naplóba kerül.</p>}
                          confirmLabel="Lezárás"
                          onConfirm={() => act(`periods/${p.id}/close`, {}, `${p.label} lezárva.`).catch(() => {})}
                        />
                      )}
                      {d.fiscalYear.status !== "CLOSED" && p.status === "CLOSED" && canReopen && (
                        <ReasonDialog
                          trigger={
                            <button type="button" className="btn btn-small" aria-label={`Feloldás: ${p.label}`}>
                              Feloldás
                            </button>
                          }
                          title={`${p.label} feloldása`}
                          description={<p>A lezárt időszak újra könyvelhető lesz. Írja le, miért kell feloldani (pl. elmaradt bizonylat).</p>}
                          confirmLabel="Feloldás"
                          onConfirm={(reason) => act(`periods/${p.id}/reopen`, { reason }, `${p.label} feloldva.`)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card stack" aria-labelledby="evzaras">
            <h2 id="evzaras">Évzárás</h2>
            {d.fiscalYear.status !== "CLOSED" && (
              <ul className="check-list">
                {checks.map((c) => (
                  <li key={c.text} className={c.ok ? "ok" : "todo"}>
                    <span aria-hidden="true">{c.ok ? "✓" : "!"}</span> {c.text} {c.link && !c.ok && <Link to={c.link}>Megnyitás</Link>}
                  </li>
                ))}
              </ul>
            )}
            {d.fiscalYear.status === "OPEN" && canClose && (
              <div>
                <ConfirmDialog
                  danger={false}
                  trigger={
                    <button type="button" className="btn btn-primary">
                      1. Zárlat indítása
                    </button>
                  }
                  title="Zárlat indítása"
                  description={
                    <p>
                      Ezután csak a mérlegfordulónapra ({formatDateHu(d.fiscalYear.endDate)}) lehet könyvelni: ezek a zárlati tételek (pl. elhatárolás, értékcsökkenés,
                      társasági adó). A zárlat visszavonható, amíg az évet le nem zárja.
                    </p>
                  }
                  confirmLabel="Zárlat indítása"
                  onConfirm={() => act(`fiscal-years/${fy.id}/start-closing`, {}, "A zárlat elindult.").catch(() => {})}
                />
              </div>
            )}
            {d.fiscalYear.status === "CLOSING" && d.preview && (
              <>
                <p>
                  Zárlati állapot: csak {formatDateHu(d.fiscalYear.endDate)}-i keltezésű zárlati tétel könyvelhető. Ha minden zárlati tétel megvan, nézze át a záró
                  tételeket, majd véglegesítse az évzárást.
                </p>
                <h3>2. A záró bizonylat előnézete</h3>
                <p>
                  Adózott eredmény: <strong>{formatHuf(Math.abs(d.preview.result))}</strong> {d.preview.result >= 0 ? "nyereség" : "veszteség"}. Az eredményszámlák
                  egyenlege a 493-on át a 419 Adózott eredmény számlára kerül; a következő év nyitásakor a 413 Eredménytartalékba.
                </p>
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Záró tételek</caption>
                    <thead>
                      <tr>
                        <th scope="col">Számla</th>
                        <th scope="col" className="num">
                          Tartozik
                        </th>
                        <th scope="col" className="num">
                          Követel
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.preview.lines.map((l, i) => (
                        <tr key={i}>
                          <td>
                            <span className="mono">{l.accountNumber}</span> {l.accountName}
                          </td>
                          <td className="num">{l.side === "D" ? formatHuf(l.amount) : ""}</td>
                          <td className="num">{l.side === "C" ? formatHuf(l.amount) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canClose && (
                  <div className="form-row">
                    <Field
                      label={`3. Az évzárás véglegesítéséhez írja be a cég rövid nevét: ${ws.company!.shortName}`}
                      error={closeError ?? undefined}
                      hint="Az évzárás után az évbe nem lehet könyvelni; újranyitni csak Adminisztrátor tudja, indoklással."
                    >
                      {(p) => <input {...p} type="text" autoComplete="off" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />}
                    </Field>
                    <div className="row" style={{ alignItems: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-danger-solid"
                        disabled={confirmName.trim() !== ws.company!.shortName}
                        onClick={async () => {
                          setCloseError(null);
                          try {
                            await post(`/api/companies/${companyId}/fiscal-years/${fy.id}/close`, { confirmName });
                            await refresh();
                            setConfirmName("");
                            toast("success", "Az évzárás megtörtént.");
                          } catch (err) {
                            setCloseError(err instanceof ApiError ? (err.fields.confirmName ?? err.message) : "Váratlan hiba történt.");
                          }
                        }}
                      >
                        Évzárás véglegesítése
                      </button>
                      <button type="button" className="btn" onClick={() => act(`fiscal-years/${fy.id}/cancel-closing`, {}, "A zárlat visszavonva, az év újra nyitott.").catch(() => {})}>
                        Zárlat visszavonása
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {d.fiscalYear.status === "CLOSED" && (
              <>
                <p>
                  Az üzleti év lezárva.{" "}
                  {d.closingDocuments.length > 0 && (
                    <>
                      Záró és nyitó bizonylat:{" "}
                      {d.closingDocuments.map((x, i) => (
                        <span key={x.id}>
                          {i > 0 && ", "}
                          <Link to={`/konyveles/${x.id}`} className="mono">
                            {x.serialNumber}
                          </Link>
                        </span>
                      ))}
                      .
                    </>
                  )}
                </p>
                {canReopen && (
                  <div>
                    <ReasonDialog
                      trigger={
                        <button type="button" className="btn btn-danger">
                          Év újranyitása
                        </button>
                      }
                      title="Üzleti év újranyitása"
                      description={
                        <p>
                          A rendszer sztornózza a záró és a nyitó bizonylatot, és az év újra könyvelhető lesz. Ha a beszámolót már elfogadták vagy közzétették, a hibát inkább
                          a következő évben, helyesbítő tétellel javítsa (Szt. 3. § (3)).
                        </p>
                      }
                      confirmLabel="Újranyitás"
                      onConfirm={(reason) => act(`fiscal-years/${fy.id}/reopen`, { reason }, "Az üzleti év újra nyitott.")}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

// ---------- Nyitó egyenlegek (meglévő cég indítása) ----------

export function OpeningPage() {
  const ws = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateDocuments();
  const accounts = useAccounts();
  const partners = usePartners();
  // Alapértelmezés: az előző hónap utolsó napja (átállás hónap elején).
  const [date, setDate] = useState(addDays(`${todayIso().slice(0, 8)}01`, -1));
  const [balancesText, setBalancesText] = useState("");
  const [customersText, setCustomersText] = useState("");
  const [suppliersText, setSuppliersText] = useState("");
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const year = Number(date.slice(0, 4)) || undefined;
  const accs = useMemo(() => accounts.data ?? [], [accounts.data]);

  const balances = useMemo(
    () =>
      parseBalancePaste(balancesText).map((b) => {
        const a = accs.find((x) => x.number === b.number);
        const error = b.error ?? (!a ? "Nincs ilyen számla a számlatükörben." : a.hasChildren ? "Gyűjtőszámla; az alszámlák egyenlegét adja meg." : a.number.startsWith("49") ? "Technikai számla, ide nem adható nyitó egyenleg." : undefined);
        return { ...b, account: a, error };
      }),
    [balancesText, accs],
  );
  const findPartner = (key: string) => {
    const digits = key.replace(/\D/g, "");
    const k = normalizeForSearch(key);
    return (partners.data ?? []).find((p) => (digits.length >= 8 && (p.taxNumber ?? "").replace(/\D/g, "").startsWith(digits.slice(0, 8))) || normalizeForSearch(p.name) === k);
  };
  const items = (text: string, sub: "CUSTOMER" | "SUPPLIER") => {
    const account = balances.find((b) => b.account?.subledger === sub)?.account ?? accs.find((a) => a.subledger === sub && !a.hasChildren && a.isActive);
    return parseOpenItemsPaste(text, year).map((o) => {
      const partner = findPartner(o.partner);
      return { ...o, account, partnerRef: partner, error: o.error ?? (!partner ? "Ismeretlen partner – vegye fel a Partnerek menüben (név vagy adószám egyezzen)." : undefined) };
    });
  };
  const custItems = items(customersText, "CUSTOMER");
  const suppItems = items(suppliersText, "SUPPLIER");
  const debit = balances.reduce((s, b) => s + b.debit, 0);
  const credit = balances.reduce((s, b) => s + b.credit, 0);
  const subChecks = balances
    .filter((b) => b.account && (b.account.subledger === "CUSTOMER" || b.account.subledger === "SUPPLIER"))
    .map((b) => {
      const list = b.account!.subledger === "CUSTOMER" ? custItems : suppItems;
      const sum = list.filter((o) => o.account?.id === b.account!.id).reduce((s, o) => s + o.amount, 0);
      const target = b.account!.subledger === "CUSTOMER" ? b.debit - b.credit : b.credit - b.debit;
      return { number: b.account!.number, sum, target, ok: sum === target };
    });
  const hasErrors = balances.some((b) => b.error) || [...custItems, ...suppItems].some((o) => o.error) || debit !== credit || subChecks.some((c) => !c.ok);

  const submit = async () => {
    setMessage(null);
    setServerErrors({});
    try {
      const r = await post<{ documents: string[] }>(`/api/companies/${ws.company!.id}/opening-balances`, {
        date,
        balances: balances.map((b) => ({ accountId: b.account!.id, debit: b.debit, credit: b.credit })),
        openItems: [...custItems, ...suppItems].map((o) => ({ accountId: o.account!.id, partnerId: o.partnerRef!.id, externalNumber: o.externalNumber, dueDate: o.dueDate, amount: o.amount })),
      });
      await invalidate();
      toast("success", `Nyitó egyenlegek rögzítve (${r.documents.length} bizonylat).`);
      navigate("/kimutatasok");
    } catch (err) {
      if (err instanceof ApiError) {
        setServerErrors(err.fields);
        setMessage(err.message);
      } else setMessage("Váratlan hiba történt.");
    }
  };

  const itemsTable = (list: ReturnType<typeof items>, caption: string) =>
    list.length > 0 && (
      <div className="table-wrap">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Sor</th>
              <th scope="col">Partner</th>
              <th scope="col">Számlaszám</th>
              <th scope="col">Esedékes</th>
              <th scope="col" className="num">
                Összeg
              </th>
              <th scope="col">Ellenőrzés</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.line}>
                <td>{o.line}.</td>
                <td>{o.partnerRef?.name ?? o.partner}</td>
                <td className="mono">{o.externalNumber}</td>
                <td>{formatDateHu(o.dueDate)}</td>
                <td className="num">{formatHuf(o.amount)}</td>
                <td>{o.error ? <span className="error">{o.error}</span> : <span className="balance-ok">✓</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  if (!ws.can("fiscalYear:manage")) {
    return (
      <>
        <SubNav label="Zárás almenü" items={TABS} />
        <PageHeader title="Nyitó egyenlegek" />
        <p>A nyitó egyenlegeket Adminisztrátor vagy Vezető könyvelő rögzítheti.</p>
      </>
    );
  }

  return (
    <>
      <SubNav label="Zárás almenü" items={TABS} />
      <PageHeader
        title="Nyitó egyenlegek átvétele"
        description="Meglévő cég indítása: másolja be a korábbi programból (pl. Excelből) a főkönyvi kivonatot és a nyitott vevő- és szállítótételeket. A rendszer nyitó bizonylatokat könyvel a 491 Nyitómérleg-számlával szemben."
      />
      <div className="form" style={{ maxWidth: 980 }}>
        <Field label="Az átvétel napja" hint="A nyitó egyenlegek erre a napra kerülnek – általában az átállás előtti hónap utolsó napja (pl. 2026.09.30.).">
          {(p) => <DateInput controlProps={p} value={date} onChange={setDate} />}
        </Field>
        <Field
          label="1. Főkönyvi kivonat (záró egyenlegek)"
          hint="Soronként: számlaszám, megnevezés (elhagyható), tartozik, követel – Excelből másolva vagy pontosvesszővel elválasztva. Évközi átállásnál az eredményszámlák (5., 8., 9. osztály) év eleje óta halmozott egyenlegét is adja meg."
        >
          {(p) => <textarea {...p} rows={8} className="mono" placeholder={"384\tBank\t1 000 000\t\n411\tJegyzett tőke\t\t3 000 000"} value={balancesText} onChange={(e) => setBalancesText(e.target.value)} />}
        </Field>
        {balances.length > 0 && (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Beolvasott egyenlegek</caption>
              <thead>
                <tr>
                  <th scope="col">Sor</th>
                  <th scope="col">Számla</th>
                  <th scope="col" className="num">
                    Tartozik
                  </th>
                  <th scope="col" className="num">
                    Követel
                  </th>
                  <th scope="col">Ellenőrzés</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b, i) => (
                  <tr key={b.line}>
                    <td>{b.line}.</td>
                    <td>
                      <span className="mono">{b.number}</span> {b.account?.name}
                    </td>
                    <td className="num">{b.debit ? formatHuf(b.debit) : ""}</td>
                    <td className="num">{b.credit ? formatHuf(b.credit) : ""}</td>
                    <td>{b.error || serverErrors[`balances.${i}`] ? <span className="error">{b.error ?? serverErrors[`balances.${i}`]}</span> : <span className="balance-ok">✓</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    Összesen
                  </th>
                  <td className="num">{formatHuf(debit)}</td>
                  <td className="num">{formatHuf(credit)}</td>
                  <td>{debit === credit ? <span className="balance-ok">Egyezik</span> : <span className="error">Eltérés: {formatHuf(Math.abs(debit - credit))}</span>}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Field label="2. Nyitott vevőtételek" hint="Soronként: partner neve vagy adószáma; számlaszám; esedékesség; összeg. Az összegük egyezzen a vevőszámla (pl. 311) egyenlegével.">
          {(p) => <textarea {...p} rows={4} className="mono" value={customersText} onChange={(e) => setCustomersText(e.target.value)} />}
        </Field>
        {itemsTable(custItems, "Nyitott vevőtételek")}
        <Field label="3. Nyitott szállítói tételek" hint="Ugyanígy; az összegük egyezzen a szállítószámla (pl. 454) egyenlegével.">
          {(p) => <textarea {...p} rows={4} className="mono" value={suppliersText} onChange={(e) => setSuppliersText(e.target.value)} />}
        </Field>
        {itemsTable(suppItems, "Nyitott szállítói tételek")}
        {subChecks.length > 0 && (
          <ul className="check-list">
            {subChecks.map((c) => (
              <li key={c.number} className={c.ok ? "ok" : "todo"}>
                <span aria-hidden="true">{c.ok ? "✓" : "!"}</span> {c.number}: nyitott tételek {formatHuf(c.sum)}, számla egyenlege {formatHuf(c.target)}
                {c.ok ? " – egyezik." : " – nem egyezik."}
              </li>
            ))}
          </ul>
        )}
        {message && (
          <div className="alert alert-error" role="alert">
            {message}
            {Object.entries(serverErrors).filter(([k]) => !k.startsWith("balances.")).length > 0 && (
              <ul>
                {Object.entries(serverErrors)
                  .filter(([k]) => !k.startsWith("balances."))
                  .map(([k, v]) => (
                    <li key={k}>{v}</li>
                  ))}
              </ul>
            )}
          </div>
        )}
        <div className="form-actions">
          <ConfirmDialog
            danger={false}
            trigger={
              <button type="button" className="btn btn-primary" disabled={balances.length === 0 || hasErrors}>
                Nyitó egyenlegek könyvelése
              </button>
            }
            title="Nyitó egyenlegek könyvelése"
            description={
              <p>
                {balances.length} számla és {custItems.length + suppItems.length} nyitott tétel kerül könyvelésre {formatDateHu(date)}-i dátummal, nyitó bizonylatokon
                (NYIT). Hibás tétel később sztornóval javítható.
              </p>
            }
            confirmLabel="Könyvelés"
            onConfirm={submit}
          />
          {hasErrors && balances.length > 0 && <span className="muted">Előbb javítsa a jelzett hibákat.</span>}
        </div>
      </div>
    </>
  );
}
