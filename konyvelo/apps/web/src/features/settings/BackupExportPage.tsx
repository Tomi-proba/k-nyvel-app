import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EXPORT_FILE_STATUS_LABELS, verifyExport, type CompanyExportDto, type ExportVerification } from "@konyvelo/shared";
import { useWorkspace } from "../../app/workspace";
import { get } from "../../lib/api";
import { formatDateTimeHu } from "../../lib/format";
import { Field } from "../../ui/Field";
import { ErrorBox, Loading, PageHeader } from "../../ui/Page";
import { useToast } from "../../ui/Toasts";
import { HelpTip } from "../../ui/Tooltip";

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("hu-HU")} kB`;

/** Beállítások → Mentés és export: cégexport letöltése és egy export ellenőrzése (K8.2). */
export function BackupExportPage() {
  const ws = useWorkspace();
  const companyId = ws.company?.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ name: string; result: ExportVerification } | null>(null);
  const [checking, setChecking] = useState(false);
  const history = useQuery({
    queryKey: ["exports", companyId],
    queryFn: () => get<CompanyExportDto[]>(`/api/companies/${companyId}/exports`),
    enabled: Boolean(companyId),
  });

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/export`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Az export nem készült el. Próbálja újra.");
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "cegexport.zip";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await queryClient.invalidateQueries({ queryKey: ["exports", companyId] });
      toast("success", `Az export elkészült: ${name}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Az export nem készült el.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(file: File | undefined) {
    if (!file) return;
    setChecking(true);
    try {
      setCheck({ name: file.name, result: await verifyExport(new Uint8Array(await file.arrayBuffer())) });
    } finally {
      setChecking(false);
    }
  }

  if (!ws.can("audit:read")) {
    return (
      <>
        <PageHeader title="Mentés és export" />
        <p className="muted">A cégexportot Adminisztrátor vagy Vezető könyvelő készítheti.</p>
      </>
    );
  }

  const known = check?.result.manifest ? history.data?.find((h) => h.manifestSha256 === check.result.manifest!.sha256) : undefined;
  const otherCompany = check?.result.manifest && ws.company && check.result.manifest.company.id !== ws.company.id;
  const problems = check ? check.result.files.filter((f) => f.status !== "OK") : [];

  return (
    <>
      <PageHeader title="Mentés és export" description="Biztonsági másolat a cég adatairól, és annak ellenőrzése, hogy egy korábbi export sértetlen-e." />

      <section className="card stack" aria-labelledby="cegexport">
        <h2 id="cegexport">
          Cégexport <HelpTip term="cegexport" />
        </h2>
        <p>
          A cég összes adata egy ZIP-fájlban: cégadatok, számlatükör, partnerek, bizonylatok és tételek, kiegyenlítések, NAV-import, audit napló. A táblázatok
          Excelben megnyithatók. A csomagban tartalomjegyzék is van, minden fájl SHA-256 lenyomatával, így később ellenőrizhető, hogy semmi nem változott.
        </p>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={download}>
            {busy ? "Készül…" : "Cégexport letöltése"}
          </button>
        </div>
        <h3>Korábbi exportok</h3>
        {history.isLoading && <Loading />}
        {history.error && <ErrorBox error={history.error} />}
        {history.data && history.data.length === 0 && <p className="muted">Még nem készült export.</p>}
        {history.data && history.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Időpont</th>
                  <th scope="col">Készítette</th>
                  <th scope="col" className="num">
                    Méret
                  </th>
                  <th scope="col">Tartalomjegyzék lenyomata (SHA-256)</th>
                </tr>
              </thead>
              <tbody>
                {history.data.slice(0, 10).map((h) => (
                  <tr key={h.at}>
                    <td>{formatDateTimeHu(h.at)}</td>
                    <td>{h.userName ?? "–"}</td>
                    <td className="num">{kb(h.bytes)}</td>
                    <td className="mono small">{h.manifestSha256.slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="ellenorzes">
        <h2 id="ellenorzes">Export ellenőrzése</h2>
        <p>Válassza ki a korábban letöltött ZIP-fájlt. A fájl nem kerül fel a szerverre: az ellenőrzés itt, a böngészőben fut.</p>
        <Field label="Cégexport fájl (.zip)">
          {(p) => <input {...p} type="file" accept=".zip,application/zip" onChange={(e) => void verify(e.target.files?.[0])} />}
        </Field>
        {checking && <Loading label="Ellenőrzés…" />}
        {check && (
          <div className="stack" aria-live="polite">
            {check.result.ok ? (
              <div className="alert alert-success" role="status">
                <strong>A csomag sértetlen.</strong> Mind a {check.result.files.length} fájl lenyomata egyezik a tartalomjegyzékkel.
              </div>
            ) : (
              <div className="alert alert-error" role="alert">
                <strong>A csomag sérült vagy módosult.</strong> Ne erre támaszkodjon; töltsön le egy új exportot.
              </div>
            )}
            {check.result.manifest && (
              <p className="muted small">
                {check.result.manifest.company.name} ({check.result.manifest.company.taxNumber}) · készült {formatDateTimeHu(check.result.manifest.generatedAt)},{" "}
                készítette: {check.result.manifest.generatedBy}
              </p>
            )}
            {check.result.manifest &&
              (otherCompany ? (
                <div className="alert alert-info">Ez egy másik cég exportja; a korábbi exportok listájával a fejlécben kiválasztott cégnél lehet összevetni.</div>
              ) : known ? (
                <div className="alert alert-success">Ezt a csomagot ez a program készítette: {formatDateTimeHu(known.at)}, {known.userName ?? "–"} (az audit napló szerint).</div>
              ) : (
                <div className="alert alert-warning">
                  A tartalomjegyzék lenyomata nem szerepel a cég exportjai között az audit naplóban. Lehet, hogy a csomagot nem ez a program készítette, vagy a
                  tartalomjegyzéket is átírták.
                </div>
              ))}
            {(problems.length > 0 || check.result.unexpected.length > 0 || check.result.errors.length > 0) && (
              <ul className="stack">
                {problems.map((f) => (
                  <li key={f.path}>
                    <span className="mono">{f.path}</span>: <strong>{EXPORT_FILE_STATUS_LABELS[f.status]}</strong>
                  </li>
                ))}
                {check.result.unexpected.map((u) => (
                  <li key={u}>
                    <span className="mono">{u}</span>: <strong>nem szerepel a tartalomjegyzékben</strong>
                  </li>
                ))}
                {check.result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="teljes-mentes">
        <h2 id="teljes-mentes">Teljes mentés</h2>
        <p>
          A teljes mentés az egész programról készül (minden cég, minden felhasználó), titkosítva. Ezt az üzemeltető állítja be úgy, hogy naponta
          automatikusan fusson. Visszaállítani is az üzemeltető tudja. Ha nem biztos benne, hogy készül mentés, kérdezze meg tőle.
        </p>
      </section>
    </>
  );
}
