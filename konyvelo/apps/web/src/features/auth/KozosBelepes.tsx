// Kétlépcsős azonosítás (kötelező) és közös belépés a portálon át (AWEBOLDAL TERV.md F21).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "../../keret/router";
import { ApiError, get, post } from "../../lib/api";
import { writeSetting } from "../../lib/storage";
import { ErrorSummary, Field } from "../../ui/Field";

function Shell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} – Könyvelő`;
  }, [title]);
  return (
    <div className="auth-page">
      <main className="auth-card" id="tartalom">
        <p className="muted" style={{ margin: 0 }}>
          Könyvelő
        </p>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
      </main>
    </div>
  );
}

const uzenet = (e: unknown) => (e instanceof Error ? e.message : "Váratlan hiba történt.");

/** A kód (vagy visszaállító kód) mezője; a visszaállító kódra egy gombbal lehet váltani. */
function KodMezok({ kod, setKod, visszaallito, setVisszaallito }: { kod: string; setKod: (v: string) => void; visszaallito: boolean; setVisszaallito: (v: boolean) => void }) {
  return (
    <>
      <Field label={visszaallito ? "Visszaállító kód" : "6 jegyű kód a hitelesítő alkalmazásból"} required>
        {(p) => (
          <input
            {...p}
            autoFocus
            autoComplete="one-time-code"
            inputMode={visszaallito ? "text" : "numeric"}
            value={kod}
            onChange={(e) => setKod(e.target.value)}
            data-kod
          />
        )}
      </Field>
      <button type="button" className="btn btn-link" onClick={() => (setVisszaallito(!visszaallito), setKod(""))}>
        {visszaallito ? "Kód a hitelesítő alkalmazásból" : "Nincs kéznél a telefon? Visszaállító kód"}
      </button>
    </>
  );
}

async function kilepes() {
  const r = await post<{ portalKilepes: string | null }>("/api/auth/logout").catch(() => null);
  if (r?.portalKilepes) location.assign(r.portalKilepes);
  else location.assign("/");
}

/** A jelszó utáni lépés: a kód megadása, vagy (első alkalommal) a kétlépcsős azonosítás beállítása. */
export function KetlepcsosPage({ beallitas }: { beallitas: boolean }) {
  const queryClient = useQueryClient();
  const [kod, setKod] = useState("");
  const [visszaallito, setVisszaallito] = useState(false);
  const [hiba, setHiba] = useState<string | null>(null);
  const [folyamatban, setFolyamatban] = useState(false);
  const [qr, setQr] = useState<{ qr: string; titok: string } | null>(null);
  const [kodok, setKodok] = useState<string[] | null>(null);

  const kesz = () => queryClient.invalidateQueries();
  const futtat = async (f: () => Promise<void>) => {
    setHiba(null);
    setFolyamatban(true);
    try {
      await f();
    } catch (e) {
      setHiba(uzenet(e));
    } finally {
      setFolyamatban(false);
    }
  };

  if (kodok) {
    return (
      <Shell title="Visszaállító kódok" intro="Írja fel vagy nyomtassa ki ezeket a kódokat, és tartsa biztonságos helyen. Ha a telefonja nincs kéznél, egy kóddal egyszer be tud lépni. Most látja őket utoljára.">
        <ol className="mono" data-visszaallito-kodok>
          {kodok.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ol>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void kesz()}>
            Felírtam, tovább
          </button>
        </div>
      </Shell>
    );
  }

  if (beallitas) {
    return (
      <Shell
        title="Kétlépcsős azonosítás beállítása"
        intro="A belépéshez a jelszó mellett egy telefonos hitelesítő alkalmazás (pl. Google Authenticator, Microsoft Authenticator) kódja is kell. Ez mindenkinek kötelező."
      >
        <ErrorSummary message={hiba} />
        {!qr ? (
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={folyamatban} onClick={() => void futtat(async () => setQr(await post("/api/auth/totp/beallitas")))}>
              QR-kód kérése
            </button>
          </div>
        ) : (
          <form
            className="form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void futtat(async () => setKodok((await post<{ visszaallitoKodok: string[] }>("/api/auth/totp/aktivalas", { kod: kod.trim() })).visszaallitoKodok));
            }}
          >
            <p>1. Olvassa be a QR-kódot a hitelesítő alkalmazással:</p>
            <img src={qr.qr} alt="QR-kód a hitelesítő alkalmazáshoz" width={220} height={220} />
            <p className="muted">
              Ha nem tudja beolvasni, írja be kézzel ezt a kulcsot: <span className="mono" data-totp-titok>{qr.titok}</span>
            </p>
            <p>2. Írja be az alkalmazás által mutatott 6 jegyű kódot:</p>
            <Field label="6 jegyű kód" required>
              {(p) => <input {...p} autoFocus autoComplete="one-time-code" inputMode="numeric" value={kod} onChange={(e) => setKod(e.target.value)} data-kod />}
            </Field>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={folyamatban}>
                Bekapcsolás
              </button>
            </div>
          </form>
        )}
        <p>
          <button type="button" className="btn btn-link" onClick={() => void kilepes()}>
            Kilépés
          </button>
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Kétlépcsős azonosítás" intro="Adja meg a hitelesítő alkalmazás kódját.">
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void futtat(async () => {
            await post("/api/auth/totp/ellenorzes", visszaallito ? { visszaallitoKod: kod } : { kod: kod.trim() });
            await kesz();
          });
        }}
      >
        <ErrorSummary message={hiba} />
        <KodMezok kod={kod} setKod={setKod} visszaallito={visszaallito} setVisszaallito={setVisszaallito} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={folyamatban}>
            Belépés
          </button>
          <button type="button" className="btn" onClick={() => void kilepes()}>
            Mégse
          </button>
        </div>
      </form>
    </Shell>
  );
}

export type SsoValasz =
  | { kovetkezo: "kesz"; companyId: string | null }
  | { kovetkezo: "osszekapcsolas"; kapcsolas: string; email: string; cegOsszerendelve: boolean; ujFiokLehet?: boolean };
export type SsoOsszekapcsolas = Extract<SsoValasz, { kovetkezo: "osszekapcsolas" }>;

/**
 * Az egyszeri fiók-összekapcsolás űrlapja (a portálról nyitott oldalon és a keretben is): a régi fiók jelszava és
 * kétlépcsős kódja; a portál-cég tulajdonosa régi fiók nélkül új fiókot is kérhet.
 */
export function OsszekapcsolasUrlap({ allapot, onKesz }: { allapot: SsoOsszekapcsolas; onKesz: (companyId: string | null) => Promise<unknown> | void }) {
  const [hiba, setHiba] = useState<string | null>(null);
  const [email, setEmail] = useState(allapot.email);
  const [jelszo, setJelszo] = useState("");
  const [kod, setKod] = useState("");
  const [visszaallito, setVisszaallito] = useState(false);
  const [folyamatban, setFolyamatban] = useState(false);
  const kuld = (f: () => Promise<{ companyId: string | null }>) => {
    setHiba(null);
    setFolyamatban(true);
    f()
      .then((r) => onKesz(r.companyId))
      .catch((err) => setHiba(uzenet(err)))
      .finally(() => setFolyamatban(false));
  };
  return (
    <>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          kuld(() =>
            post<{ companyId: string | null }>("/api/auth/sso/osszekapcsolas", {
              kapcsolas: allapot.kapcsolas,
              email,
              jelszo,
              ...(kod ? (visszaallito ? { visszaallitoKod: kod } : { kod: kod.trim() }) : {}),
            }),
          );
        }}
      >
        <ErrorSummary message={hiba} />
        <Field label="E-mail-cím a Könyvelőben" required>
          {(p) => <input {...p} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Jelszó a Könyvelőben" required>
          {(p) => <input {...p} type="password" autoComplete="current-password" autoFocus value={jelszo} onChange={(e) => setJelszo(e.target.value)} />}
        </Field>
        <KodMezok kod={kod} setKod={setKod} visszaallito={visszaallito} setVisszaallito={setVisszaallito} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={folyamatban}>
            Összekapcsolás és belépés
          </button>
        </div>
      </form>
      {allapot.ujFiokLehet && (
        <section className="card" style={{ marginTop: 24 }} data-uj-fiok>
          <h2>Nincs még Könyvelő-fiókja?</h2>
          <p className="muted">
            A cég tulajdonosaként új Könyvelő-fiókot kérhet a portál-fiókja adataival ({allapot.email}). Utána a Könyvelő-céget a portál
            cégadataival hozhatja létre.
          </p>
          <button
            type="button"
            className="btn"
            disabled={folyamatban}
            onClick={() => kuld(() => post<{ companyId: string | null }>("/api/auth/sso/uj-fiok", { kapcsolas: allapot.kapcsolas }))}
          >
            Új Könyvelő-fiók a portál adataival
          </button>
        </section>
      )}
      {!allapot.cegOsszerendelve && !allapot.ujFiokLehet && (
        <p className="muted">
          Nincs még Könyvelő-fiókja? Kérje meg a cég tulajdonosát vagy adminisztrátorát, hogy a portálról belépve rendelje össze a Könyvelő-céget
          a portál cégével. Utána a fiókja magától létrejön.
        </p>
      )}
    </>
  );
}

/** Belépés a portálról: a jegy az URL `#jegy=` részében jön (nem kerül a szervernaplókba), és egyszer használható. */
export function SsoPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const elkuldve = useRef(false);
  const [allapot, setAllapot] = useState<SsoValasz | null>(null);
  const [hiba, setHiba] = useState<string | null>(null);

  const belepett = async (companyId: string | null) => {
    if (companyId) writeSetting("companyId", companyId);
    queryClient.clear();
    navigate("/", { replace: true });
    await queryClient.invalidateQueries();
  };

  useEffect(() => {
    if (elkuldve.current) return;
    elkuldve.current = true;
    const jegy = new URLSearchParams(location.hash.slice(1)).get("jegy");
    history.replaceState(null, "", "/sso");
    if (!jegy) {
      setHiba("Hiányzik a belépési jegy. Nyissa meg a Könyvelőt a portálról.");
      return;
    }
    post<SsoValasz>("/api/auth/sso", { jegy })
      .then(async (r) => {
        if (r.kovetkezo === "kesz") return belepett(r.companyId);
        setAllapot(r);
      })
      .catch((e) => setHiba(uzenet(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (allapot?.kovetkezo === "osszekapcsolas") {
    return (
      <Shell
        title="Fiók összekapcsolása"
        intro="Ezzel a portál-fiókkal még nem lépett be a Könyvelőbe. Ha már van Könyvelő-fiókja, lépjen be vele egyszer (jelszó és kétlépcsős kód): utána a portálról mindig közvetlenül nyílik meg."
      >
        <OsszekapcsolasUrlap allapot={allapot} onKesz={belepett} />
      </Shell>
    );
  }

  return (
    <Shell title="Belépés a portálról">
      {hiba ? (
        <div className="alert alert-error" role="alert">
          {hiba}
        </div>
      ) : (
        <p className="muted">Belépés folyamatban…</p>
      )}
    </Shell>
  );
}

/** Közös belépésnél (a portálról nyitva) a cég-adminisztrátor összerendelheti a céget a portál cégével. */
export function PortalCegOsszerendeles({ companyId, sso, admin }: { companyId: string; sso: boolean; admin: boolean }) {
  const [allapot, setAllapot] = useState<string | null>(null);
  if (!sso || !admin) return null;
  return (
    <section className="card" style={{ marginTop: 24 }} data-portal-osszerendeles>
      <h2>Közös belépés</h2>
      <p className="muted">
        Ha a cég a portálon is megvan, rendelje össze: a portálon felvett munkatársak fiókja ekkor magától létrejön a Könyvelőben, a portálon
        megadott szerepkörrel.
      </p>
      {allapot && <p role="status">{allapot}</p>}
      <button
        type="button"
        className="btn"
        onClick={() =>
          post("/api/auth/sso/ceg", { companyId })
            .then(() => setAllapot("A cég össze van rendelve a portál cégével."))
            .catch((e) => setAllapot(uzenet(e)))
        }
      >
        Összerendelés a portál cégével
      </button>
    </section>
  );
}

type Atallas = { sso: boolean; regiBelepes: boolean; regiBelepesKapcsolo: boolean; tagok: Array<{ id: string; email: string; name: string; ketlepcsos: boolean; osszekapcsolva: boolean }> };

/** Átállási lista: kinek van már kétlépcsős azonosítása, és ki kapcsolta össze a fiókját a portállal. */
export function AtallasiLista() {
  const q = useQuery({
    queryKey: ["sso-atallas"],
    queryFn: async () => {
      try {
        return await get<Atallas>("/api/auth/sso/atallas");
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
  if (!q.data) return null;
  const d = q.data;
  return (
    <section className="card" style={{ marginTop: 24 }} data-atallasi-lista>
      <h2>Átállás a közös belépésre</h2>
      <p className="muted">
        {d.sso ? "A közös belépés be van kapcsolva." : "A közös belépés még nincs bekapcsolva."}{" "}
        {d.regiBelepes
          ? "A régi belépés (jelszó + kétlépcsős kód) addig marad, amíg mindenki össze nem kapcsolta a fiókját."
          : "A régi belépés ki van kapcsolva: mindenki a portálon át lép be."}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Név</th>
            <th>E-mail</th>
            <th>Kétlépcsős azonosítás</th>
            <th>Portál-fiók</th>
          </tr>
        </thead>
        <tbody>
          {d.tagok.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.email}</td>
              <td>{t.ketlepcsos ? "beállítva" : "még nincs"}</td>
              <td>{t.osszekapcsolva ? "összekapcsolva" : "még nincs"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export { kilepes };
