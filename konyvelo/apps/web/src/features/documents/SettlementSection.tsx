import { formatHuf } from "@konyvelo/domain";
import type { OpenItemDto } from "@konyvelo/shared";
import { formatDateHu } from "../../lib/format";
import { AmountInput, amountText } from "../../ui/AmountInput";
import { HelpTip } from "../../ui/Tooltip";
import type { PlanRow } from "./entry-model";

/**
 * A partner nyitott tételei a rögzítő űrlapon: a kijelölt tételeket ez a
 * bizonylat egyenlíti ki (részben is). Az első kijelöléskor – ha még üresek
 * a sorok – a tételsorok is kitöltődnek.
 */
export function SettlementSection({
  items,
  plan,
  errors,
  onChange,
  onFillRows,
}: {
  items: OpenItemDto[];
  plan: PlanRow[];
  errors: Record<string, string>;
  onChange: (plan: PlanRow[]) => void;
  onFillRows: () => void;
}) {
  const selected = new Map(plan.map((p, i) => [p.itemLineId, { ...p, index: i }]));
  // A már kijelölt, de időközben lezárult tétel is látszódjon (hibaüzenettel).
  const visible = [...items, ...plan.filter((p) => !items.some((i) => i.lineId === p.itemLineId)).map((p) => ({ lineId: p.itemLineId, missing: true }) as const)];
  return (
    <section className="card" aria-labelledby="kiegyenlites">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="kiegyenlites" style={{ margin: 0 }}>
          Kiegyenlítendő tételek <HelpTip term="kiegyenlites" />
        </h2>
        {plan.length > 0 && (
          <button type="button" className="btn btn-small" onClick={onFillRows}>
            Tételsorok kitöltése a kijelöltekből
          </button>
        )}
      </div>
      {errors.settlements && (
        <p className="error" role="alert">
          {errors.settlements}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">A partner nyitott tételei</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Kijelölés</span>
              </th>
              <th scope="col">Bizonylat</th>
              <th scope="col">Számlaszám</th>
              <th scope="col">Határidő</th>
              <th scope="col" className="num">
                Nyitott
              </th>
              <th scope="col" className="num">
                Kiegyenlítés
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((v) => {
              const sel = selected.get(v.lineId);
              const err = sel ? errors[`settlements.${sel.index}`] : undefined;
              if ("missing" in v) {
                return (
                  <tr key={v.lineId}>
                    <td colSpan={6} className="error">
                      {err ?? "A korábban kijelölt tétel már nem nyitott."}{" "}
                      <button type="button" className="btn btn-small" onClick={() => onChange(plan.filter((p) => p.itemLineId !== v.lineId))}>
                        Eltávolítás
                      </button>
                    </td>
                  </tr>
                );
              }
              const it = v as OpenItemDto;
              const label = `${it.serialNumber} (${it.externalNumber ?? ""})`;
              return (
                <tr key={it.lineId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${label} kiegyenlítése`}
                      checked={Boolean(sel)}
                      onChange={(e) =>
                        onChange(e.target.checked ? [...plan, { itemLineId: it.lineId, amount: amountText(it.open) }] : plan.filter((p) => p.itemLineId !== it.lineId))
                      }
                    />
                  </td>
                  <td className="mono nowrap">{it.serialNumber}</td>
                  <td className="mono">{it.externalNumber}</td>
                  <td>
                    {formatDateHu(it.dueDate)}
                    {it.daysOverdue > 0 && <span className="badge badge-warning">lejárt</span>}
                  </td>
                  <td className="num">{formatHuf(it.open)}</td>
                  <td className="col-amount">
                    {sel && (
                      <>
                        <AmountInput
                          value={sel.amount}
                          onChange={(t) => onChange(plan.map((p) => (p.itemLineId === it.lineId ? { ...p, amount: t } : p)))}
                          controlProps={{
                            id: `settle-${it.lineId}`,
                            "aria-label": `${label}: kiegyenlített összeg`,
                            "aria-invalid": Boolean(err),
                            "aria-describedby": err ? `settle-${it.lineId}-err` : undefined,
                            "aria-required": undefined,
                          }}
                        />
                        {err && (
                          <div className="error" id={`settle-${it.lineId}-err`}>
                            {err}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Ha a fizetés több, mint a kijelölt tételek összege, a különbözet párosítatlan fizetésként (túlfizetés, előleg) marad, és később párosítható.
      </p>
    </section>
  );
}
