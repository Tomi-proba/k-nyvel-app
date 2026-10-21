import { Link } from "react-router";
import { addDays, DOCUMENT_TYPES, formatDateHu, formatHuf, todayIso } from "@konyvelo/domain";
import { ROLE_LABELS } from "@konyvelo/shared";
import { NEW_ENTRY_PATH } from "../../app/AppLayout";
import { KeyCombo } from "../../app/shortcuts";
import { useWorkspace } from "../../app/workspace";
import { fiscalYearLabel, periodLabel } from "../../lib/format";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { HelpTip } from "../../ui/Tooltip";
import { deadlineText, useTodos } from "../documents/queries";

type Todo = { key: string; to: string; title: string; detail?: string; tone: "danger" | "warning" | "info" };

/** Ennyi piszkozatot mutatunk egyenként; a többi a listában érhető el. */
const MAX_DRAFTS = 5;

/**
 * Teendők: minden elem kattintható, és a megfelelő képernyőre visz
 * (piszkozat szerkesztése, szűrt bizonylatlista, beállítás).
 */
function TodoCard() {
  const ws = useWorkspace();
  const todos = useTodos();

  if (!ws.fiscalYearsLoading && ws.fiscalYears.length === 0) {
    return (
      <div className="stack">
        <p>Még nincs üzleti év. A könyveléshez hozza létre az első üzleti évet.</p>
        {ws.can("fiscalYear:manage") ? (
          <Link to="/beallitasok/uzleti-evek" className="btn btn-primary">
            Üzleti év létrehozása
          </Link>
        ) : (
          <p className="muted">Ezt Adminisztrátor vagy Vezető könyvelő teheti meg.</p>
        )}
      </div>
    );
  }
  if (todos.isLoading) return <Loading />;
  if (todos.error) return <ErrorBox error={todos.error} />;
  const t = todos.data!;

  const items: Todo[] = [];
  const today = todayIso();
  if (ws.fiscalYears.length > 0 && !ws.fiscalYears.some((y) => y.startDate <= today && today <= y.endDate)) {
    items.push({
      key: "fy",
      to: "/beallitasok/uzleti-evek",
      title: "A mai nap egyik üzleti évbe sem esik",
      detail: `A ${formatDateHu(today)}-i tételek rögzítéséhez hozza létre a következő üzleti évet.`,
      tone: "warning",
    });
  }
  const overdue = t.drafts.filter((d) => d.deadline.status === "OVERDUE").length;
  const dueSoon = t.drafts.filter((d) => d.deadline.status === "DUE_SOON").length;
  if (overdue + dueSoon > 0) {
    items.push({
      key: "deadline",
      to: "/konyveles?allapot=piszkozat",
      title: `Rögzítési határidő: ${[overdue && `${overdue} lejárt`, dueSoon && `${dueSoon} hamarosan lejár`].filter(Boolean).join(", ")}`,
      detail: "Piszkozatban lévő bizonylatok, amelyeket a számviteli törvény szerint már könyvelni kellett volna, vagy hamarosan kell (Szt. 165. § (3)).",
      tone: overdue ? "danger" : "warning",
    });
  }
  for (const d of t.drafts.slice(0, MAX_DRAFTS)) {
    items.push({
      key: d.id,
      to: `/konyveles/${d.id}`,
      title: `Piszkozat: ${d.description || DOCUMENT_TYPES[d.docType].label}`,
      detail: `${DOCUMENT_TYPES[d.docType].label} · ${formatDateHu(d.accountingDate)} · ${formatHuf(d.total)} · ${deadlineText(d.deadline)}`,
      tone: d.deadline.status === "OVERDUE" ? "danger" : d.deadline.status === "DUE_SOON" ? "warning" : "info",
    });
  }
  if (t.drafts.length > MAX_DRAFTS) {
    items.push({
      key: "more-drafts",
      to: "/konyveles?allapot=piszkozat",
      title: `További ${t.drafts.length - MAX_DRAFTS} piszkozat`,
      detail: "Az összes piszkozat listája.",
      tone: "info",
    });
  }
  if (t.latePostedLast30Days > 0) {
    items.push({
      key: "late",
      to: "/konyveles?hatarido=keso",
      title: `${t.latePostedLast30Days} bizonylatot határidőn túl könyveltek az elmúlt 30 napban`,
      detail: "Érdemes átnézni, mi okozta a késést (Szt. 165. § (3)).",
      tone: "warning",
    });
  }
  if (t.overdueReceivables.count > 0) {
    items.push({
      key: "overdue-ar",
      to: "/partnerek/nyitott-tetelek?tipus=vevo&lejart=1",
      title: `${t.overdueReceivables.count} lejárt vevőkövetelés: ${formatHuf(t.overdueReceivables.total)}`,
      detail: "A fizetési határidő lejárt, de a tétel még nincs kiegyenlítve.",
      tone: "warning",
    });
  }
  if (t.overduePayables.count > 0) {
    items.push({
      key: "overdue-ap",
      to: "/partnerek/nyitott-tetelek?tipus=szallito&lejart=1",
      title: `${t.overduePayables.count} lejárt szállítói számla: ${formatHuf(t.overduePayables.total)}`,
      detail: "Fizetendő, a határidő már lejárt.",
      tone: "danger",
    });
  }
  if (t.unappliedPayments > 0) {
    items.push({
      key: "unapplied",
      to: "/partnerek/nyitott-tetelek",
      title: `${t.unappliedPayments} párosítatlan fizetés`,
      detail: "Túlfizetés vagy előleg, illetve olyan fizetés, amelyhez még nem választottak számlát.",
      tone: "info",
    });
  }
  for (const c of new Map(t.cashOverLimit.map((x) => [x.accountId, x])).values()) {
    items.push({
      key: `cash-${c.accountId}`,
      to: `/konyveles/penzeszkozok?szamla=${c.accountId}`,
      title: `Pénztár (${c.accountNumber}): a záróegyenleg meghaladta a maximumot`,
      detail: `Legutóbb ${formatDateHu(c.date)}: ${formatHuf(c.closing)} (maximum: ${formatHuf(c.limit)}, pénzkezelési szabályzat).`,
      tone: "warning",
    });
  }
  // Lezárható havi időszakok: a már elmúlt, 15 napnál régebben véget ért, még nyitott hónapok.
  const closable = (ws.fiscalYear?.periods ?? []).filter((p) => p.status === "OPEN" && addDays(p.endDate, 15) < today);
  if (closable.length > 0 && ws.can("period:close")) {
    items.push({
      key: "periods",
      to: "/zaras",
      title: `${closable.length} elmúlt havi időszak még nyitott`,
      detail: `Legrégebbi: ${periodLabel(closable[0]!)}. A lezárás után oda nem lehet könyvelni.`,
      tone: "info",
    });
  }
  if (t.unmappedAccounts > 0) {
    items.push({
      key: "mapping",
      to: "/beallitasok/szamlatukor",
      title: `${t.unmappedAccounts} számlához nincs kimutatássor`,
      detail: "Ezek egyenlege nem kerülne be a mérlegbe vagy az eredménykimutatásba.",
      tone: "warning",
    });
  }

  if (items.length === 0) return <p className="muted">Nincs teendő. Minden bizonylat könyvelve van.</p>;
  return (
    <ul className="todo-list">
      {items.map((i) => (
        <li key={i.key}>
          <Link to={i.to} className={`todo todo-${i.tone}`}>
            <span className="todo-title">{i.title}</span>
            {i.detail && <span className="todo-detail">{i.detail}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HomePage() {
  const ws = useWorkspace();

  if (!ws.company) {
    return (
      <>
        <PageHeader title="Kezdőlap" description={`Üdvözöljük, ${ws.me.user.name}!`} />
        <div className="card">
          <h2>Még nincs cége</h2>
          <p>A könyveléshez először vegyen fel egy céget. Később több céget is kezelhet, és a fejlécben válthat közöttük.</p>
          <Link to="/cegek/uj" className="btn btn-primary">
            Új cég létrehozása
          </Link>
        </div>
      </>
    );
  }

  const fy = ws.fiscalYear;
  const openPeriods = fy?.periods.filter((p) => p.status === "OPEN").length ?? 0;

  return (
    <>
      <PageHeader title="Kezdőlap" description={`${ws.company.name} · szerepköre: ${ROLE_LABELS[ws.company.role]}`} />

      <div className="grid-2">
        <section className="card" aria-labelledby="teendok">
          <h2 id="teendok">
            Teendők <HelpTip term="rogzitesiHatarido" />
          </h2>
          <TodoCard />
        </section>

        <section className="card" aria-labelledby="uzleti-ev">
          <h2 id="uzleti-ev">Üzleti év</h2>
          {fy ? (
            <dl className="stack" style={{ margin: 0 }}>
              <div>
                <dt className="muted">Kiválasztott üzleti év</dt>
                <dd style={{ margin: 0 }}>
                  <strong>{fiscalYearLabel(fy)}</strong> ({formatDateHu(fy.startDate)} – {formatDateHu(fy.endDate)})
                </dd>
              </div>
              <div>
                <dt className="muted">Nyitott időszakok</dt>
                <dd style={{ margin: 0 }}>
                  {openPeriods} / {fy.periods.length}
                  {fy.periods[0] && ` (első: ${periodLabel(fy.periods[0])})`}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Nincs kiválasztott üzleti év.</p>
          )}
        </section>

        <section className="card card-muted" aria-labelledby="gyors">
          <h2 id="gyors">Gyors rögzítés</h2>
          <p>
            Új bizonylat bárhonnan: <KeyCombo keys={["Alt", "N"]} />, <KeyCombo keys={["F2"]} /> vagy <KeyCombo keys={["N"]} /> (ha nem beviteli
            mezőben áll a kurzor). Rögzítés közben sablon: <KeyCombo keys={["Alt", "L"]} />.
          </p>
          {ws.can("ledger:post") && (
            <p>
              <Link to={NEW_ENTRY_PATH} className="btn btn-primary">
                Új bizonylat
              </Link>
            </p>
          )}
          <p className="muted" style={{ margin: 0 }}>
            Az összes gyorsbillentyű listája: <KeyCombo keys={["?"]} />
          </p>
        </section>
      </div>
    </>
  );
}
