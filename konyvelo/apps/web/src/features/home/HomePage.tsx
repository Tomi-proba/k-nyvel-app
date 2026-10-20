import { Link } from "react-router";
import { formatDateHu } from "@konyvelo/domain";
import { ROLE_LABELS } from "@konyvelo/shared";
import { KeyCombo } from "../../app/shortcuts";
import { useWorkspace } from "../../app/workspace";
import { fiscalYearLabel, periodLabel } from "../../lib/format";
import { PageHeader } from "../../ui/Page";

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
          <h2 id="teendok">Teendők</h2>
          {!ws.fiscalYearsLoading && ws.fiscalYears.length === 0 ? (
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
          ) : (
            <p className="muted">Nincs sürgős teendő. A bizonylatok, a NAV-ból érkező számlák és a lejárt tételek a következő lépésekben jelennek meg itt.</p>
          )}
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
            Új tétel bárhonnan: <KeyCombo keys={["Alt", "N"]} />, <KeyCombo keys={["F2"]} /> vagy <KeyCombo keys={["N"]} /> (ha nem
            beviteli mezőben áll a kurzor).
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Az összes gyorsbillentyű listája: <KeyCombo keys={["?"]} />
          </p>
        </section>
      </div>
    </>
  );
}
