// A Könyvelő a közös keretben (TERV.md F23 KB3–KB4). A keret adja a céget, az időszakot, a témát, a
// gyorsbillentyűket, az értesítéseket és a súgót; a Könyvelő saját fejléce, cégválasztója, üzleti év
// választója és téma-kapcsolója itt nem jelenik meg.
//
// Belépés: a Könyvelő a háttérben kér belépési jegyet a portáltól (a keret belépésével), és azzal lép be –
// átirányítás, új ablak és újabb belépés nélkül. Cégváltáskor (a keret cégváltójával) új jegy a választott céggel.
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
import { ariaFelirat, feliratok } from "@aweboldal/modulok";
import { keretBillentyu, useGyorsbillentyu, useGyorsbillentyuk, useKeret } from "@aweboldal/felulet";
import { ROLE_LABELS, type CompanyDto, type MeResponse } from "@konyvelo/shared";
import { NEW_ENTRY_PATH } from "../app/AppLayout";
import { Utvonalak } from "../app/Utvonalak";
import { WorkspaceProvider, useWorkspace } from "../app/workspace";
import { OsszekapcsolasUrlap, type SsoOsszekapcsolas, type SsoValasz } from "../features/auth/KozosBelepes";
import { CompanyForm } from "../features/settings/CompanyForm";
import { ApiError, get, post } from "../lib/api";
import { fiscalYearLabel } from "../lib/format";
import { ujQueryClient } from "../lib/lekerdezes";
import { ErrorBox, Loading } from "../ui/Page";
import { Tooltip } from "../ui/Tooltip";
import { keretModBeallitas } from "./futas";
import { FoGombKontextus, type FoMuvelet } from "./FoGomb";
import { Link, NavLink, useNavigate } from "./router";

const queryClient = ujQueryClient();

const uzenet = (e: unknown) => (e instanceof Error ? e.message : "Váratlan hiba történt.");

/** A Könyvelő munkamenete (401: nincs, vagy még nincs kétlépcsős: ilyenkor a jegy új munkamenetet ad). */
async function sajatMe(): Promise<MeResponse | null> {
  try {
    return await get<MeResponse>("/api/auth/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

/** A modul képernyői a keretben: ezt adja a csomag `Kepernyok`-ként. */
export function KeretKepernyok({ alapUtvonal }: { alapUtvonal: string }) {
  const k = useKeret();
  keretModBeallitas(alapUtvonal, k.apiAlap("konyvelo"));
  return (
    <QueryClientProvider client={queryClient}>
      <RadixTooltip.Provider>
        <KeretBelepes />
      </RadixTooltip.Provider>
    </QueryClientProvider>
  );
}

type Belepes = { fajta: "folyamatban" } | { fajta: "hiba"; uzenet: string } | { fajta: "osszekapcsolas"; valasz: SsoOsszekapcsolas };

function KeretBelepes() {
  const k = useKeret();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: sajatMe });
  const [belepes, setBelepes] = useState<Belepes | null>(null);
  const probalt = useRef<string | null>(null);
  // Új jegy kell, ha nincs munkamenet, vagy az egy másik portál-céghez (vagy nem a portálról) szól.
  const kellJegy = me.isSuccess && (!me.data || me.data.ssoPortalCompanyId !== k.ceg.id);

  const ujraToltes = async () => {
    setBelepes(null);
    await qc.resetQueries();
  };

  useEffect(() => {
    if (!kellJegy || probalt.current === k.ceg.id) return;
    probalt.current = k.ceg.id;
    setBelepes({ fajta: "folyamatban" });
    (async () => {
      const jegy = await k.jegyKeres("konyvelo");
      const r = await post<SsoValasz>("/api/auth/sso", { jegy });
      if (r.kovetkezo === "kesz") await ujraToltes();
      else setBelepes({ fajta: "osszekapcsolas", valasz: r });
    })().catch((e) => setBelepes({ fajta: "hiba", uzenet: uzenet(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kellJegy, k.ceg.id]);

  if (belepes?.fajta === "hiba") {
    return (
      <div className="alert alert-error" role="alert" data-konyvelo-belepes-hiba>
        A Könyvelő most nem nyitható meg: {belepes.uzenet}{" "}
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            probalt.current = null;
            void ujraToltes();
          }}
        >
          Újrapróbálás
        </button>
      </div>
    );
  }
  if (belepes?.fajta === "osszekapcsolas") {
    return (
      <div className="konyvelo-keret konyvelo-keret--keskeny" data-konyvelo-osszekapcsolas>
        <h1>Könyvelő – fiók összekapcsolása</h1>
        <p className="muted">
          Ezzel a portál-fiókkal még nem lépett be a Könyvelőbe. Ha már van Könyvelő-fiókja, lépjen be vele egyszer (jelszó és kétlépcsős kód):
          utána a Könyvelő mindig közvetlenül nyílik meg.
        </p>
        <OsszekapcsolasUrlap allapot={belepes.valasz} onKesz={ujraToltes} />
      </div>
    );
  }
  if (me.error) return <ErrorBox error={me.error} />;
  if (kellJegy && probalt.current === k.ceg.id && !belepes) {
    return (
      <div className="alert alert-error" role="alert" data-konyvelo-belepes-hiba>
        A Könyvelő belépése nem sikerült ehhez a céghez. Kérjük, frissítse az oldalt.
      </div>
    );
  }
  if (!me.data || kellJegy || belepes) return <Loading label="A Könyvelő megnyitása…" />;

  const company = me.data.companies.find((c) => c.portalCompanyId === k.ceg.id);
  if (!company) return <CegOsszerendeles me={me.data} onKesz={ujraToltes} />;
  return (
    <WorkspaceProvider me={me.data} keretCegId={company.id}>
      <Utvonalak me={me.data} layout={<KeretLayout />} />
    </WorkspaceProvider>
  );
}

/**
 * A portál cégéhez még nincs Könyvelő-cég. A tulajdonos kiválaszt egy meglévőt (ahol Adminisztrátor), vagy újat
 * hoz létre a portál cégadataival; más felhasználó üzenetet kap.
 */
function CegOsszerendeles({ me, onKesz }: { me: MeResponse; onKesz: () => Promise<void> }) {
  const k = useKeret();
  const navigate = useNavigate();
  const valaszthato = me.companies.filter((c) => c.role === "ADMIN" && !c.portalCompanyId);
  const [mod, setMod] = useState<"meglevo" | "uj">(valaszthato.length ? "meglevo" : "uj");
  const [valasztott, setValasztott] = useState(valaszthato[0]?.id ?? "");
  const [hiba, setHiba] = useState<string | null>(null);
  const [folyamatban, setFolyamatban] = useState(false);
  const [automatikusHiba, setAutomatikusHiba] = useState<string | null>(null);

  if (k.ceg.szerep !== "tulajdonos") {
    return (
      <div className="konyvelo-keret konyvelo-keret--keskeny" data-ceg-osszerendeles="nem-tulajdonos">
        <h1>Könyvelő</h1>
        <div className="alert alert-info" role="status">
          A(z) {k.ceg.nev} cégnek még nincs Könyvelő-cége. Az első megnyitáskor a cég tulajdonosa rendeli össze (vagy hozza létre); utána a
          Könyvelő itt magától megnyílik.
        </div>
      </div>
    );
  }

  const osszerendel = async (companyId: string) => {
    await post("/api/auth/sso/ceg", { companyId });
    k.ertesit(`A Könyvelő-cég össze van rendelve: ${k.ceg.nev}.`, "siker");
    await onKesz();
  };

  // Aki most vásárolt (nincs meglévő Könyvelő-cége): a cég a portál cégadataival és az első üzleti év magától
  // létrejön, kérdés nélkül. Ha valami hiányzik (pl. az adószám), az űrlap jelenik meg a hibával.
  if (!valaszthato.length && !automatikusHiba) return <AutomatikusBeallitas onHiba={setAutomatikusHiba} onKesz={onKesz} />;

  return (
    <div className="konyvelo-keret konyvelo-keret--keskeny" data-ceg-osszerendeles>
      <h1>Könyvelő – a cég első megnyitása</h1>
      <p className="muted">
        A(z) {k.ceg.nev} céghez még nem tartozik Könyvelő-cég. Válasszon egy meglévőt, vagy hozzon létre újat a portál cégadataival. Ezt csak
        egyszer kell megtenni; a cég munkatársai utána a portál szerepkörük szerint érik el.
      </p>
      {valaszthato.length > 0 && (
        <div className="row" role="radiogroup" aria-label="Mit szeretne?" style={{ marginBottom: 16 }}>
          <label>
            <input type="radio" name="osszerendeles-mod" checked={mod === "meglevo"} onChange={() => setMod("meglevo")} /> Meglévő Könyvelő-cég
          </label>
          <label>
            <input type="radio" name="osszerendeles-mod" checked={mod === "uj"} onChange={() => setMod("uj")} /> Új Könyvelő-cég
          </label>
        </div>
      )}
      {(hiba ?? automatikusHiba) && (
        <div className="alert alert-error" role="alert">
          {hiba ?? `A Könyvelő-cég nem jött létre magától: ${automatikusHiba} Kérjük, ellenőrizze az adatokat.`}
        </div>
      )}
      {mod === "meglevo" ? (
        <form
          className="form card"
          onSubmit={(e) => {
            e.preventDefault();
            setHiba(null);
            setFolyamatban(true);
            osszerendel(valasztott)
              .catch((err) => setHiba(uzenet(err)))
              .finally(() => setFolyamatban(false));
          }}
        >
          <fieldset>
            <legend>Könyvelő-cég, amelyben Adminisztrátor</legend>
            {valaszthato.map((c) => (
              <label key={c.id} style={{ display: "block" }}>
                <input type="radio" name="meglevo-ceg" value={c.id} checked={valasztott === c.id} onChange={() => setValasztott(c.id)} /> {c.name} (
                {ROLE_LABELS[c.role]})
              </label>
            ))}
          </fieldset>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={folyamatban || !valasztott}>
              Összerendelés
            </button>
          </div>
        </form>
      ) : (
        <CompanyForm
          kezdo={{ name: k.ceg.nev, shortName: k.ceg.nev.slice(0, 60), taxNumber: k.ceg.adoszam }}
          submitLabel="Könyvelő-cég létrehozása"
          onSubmit={async (data) => {
            const created = await post<CompanyDto>("/api/companies", data);
            await osszerendel(created.id);
            navigate("/beallitasok/uzleti-evek");
          }}
        />
      )}
    </div>
  );
}

/**
 * Első megnyitás, meglévő Könyvelő-cég nélkül: a Könyvelő-cég a portál cégadataival, utána az első üzleti év (a
 * javasolt dátumokkal) magától létrejön. A beszámolóforma és az árfolyamforrás az alapértelmezett; a Beállításokban
 * bármikor módosítható.
 */
function AutomatikusBeallitas({ onHiba, onKesz }: { onHiba: (uzenet: string) => void; onKesz: () => Promise<void> }) {
  const k = useKeret();
  const elindult = useRef(false);
  useEffect(() => {
    if (elindult.current) return;
    elindult.current = true;
    void (async () => {
      const ceg = await post<CompanyDto>("/api/companies", {
        name: k.ceg.nev,
        shortName: k.ceg.nev.slice(0, 60),
        taxNumber: k.ceg.adoszam,
        reportType: "SIMPLIFIED_ANNUAL",
        fxRateSource: "MNB",
      });
      await post("/api/auth/sso/ceg", { companyId: ceg.id });
      const javaslat = await get<{ startDate: string; endDate: string }>(`/api/companies/${ceg.id}/fiscal-years/suggestion`);
      await post(`/api/companies/${ceg.id}/fiscal-years`, javaslat);
      k.ertesit(`A Könyvelő elkészült (${k.ceg.nev})`, "siker");
      await onKesz();
    })().catch((err) => onHiba(uzenet(err)));
  }, [k, onHiba, onKesz]);
  return <Loading label="A Könyvelő előkészítése a cég adataival…" />;
}

/** A keretbeli elrendezés: a fejléc a kereté; itt csak a Könyvelő eszközsora és a tartalom. */
export function KeretLayout() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const gy = useGyorsbillentyuk();
  const ujTetel = keretBillentyu("uj-tetel");
  // Egy fő gomb oldalanként (F27 B3): az oldal adja meg (FoGomb), különben az „Új bizonylat”; űrlapon nincs.
  const [foMuvelet, setFoMuvelet] = useState<FoMuvelet | null | undefined>(undefined);
  const fo: FoMuvelet | null =
    foMuvelet === null ? null : foMuvelet ?? (ws.can("ledger:post") ? { cim: "Új bizonylat", to: NEW_ENTRY_PATH } : null);
  const futtat = () => {
    if (!fo) return;
    if (fo.to) navigate(fo.to);
    else fo.onClick?.();
  };
  useGyorsbillentyu(fo ? ujTetel : undefined, futtat);
  const nincsEv = ws.keretIdoszak && !ws.fiscalYear && !ws.fiscalYearsLoading && ws.fiscalYears.length > 0;

  return (
    <div className="konyvelo-keret" data-konyvelo-keret>
      <div className="konyvelo-keret__eszkozok">
        <span className="muted" data-konyvelo-uzleti-ev>
          {ws.fiscalYear ? `Üzleti év: ${fiscalYearLabel(ws.fiscalYear)}` : ""}
        </span>
        <span className="header-spacer" />
        <NavLink to="/sugo" className="btn btn-small">
          Súgó
        </NavLink>
        {fo && (
          <Tooltip content={<>{fo.cim} – {feliratok(ujTetel, gy.mac)}</>}>
            <button type="button" className="btn btn-primary" aria-keyshortcuts={ariaFelirat(ujTetel)} onClick={futtat} data-fo-gomb>
              <span aria-hidden="true">+</span> {fo.cim}
            </button>
          </Tooltip>
        )}
      </div>
      {nincsEv && ws.keretIdoszak && (
        <div className="alert alert-warning" role="status" data-nincs-uzleti-ev>
          A választott időszak ({ws.keretIdoszak.szoveg}) egyik üzleti évbe sem esik.{" "}
          {ws.can("fiscalYear:manage") ? (
            <Link to="/beallitasok/uzleti-evek">Üzleti év felvétele</Link>
          ) : (
            "Üzleti évet Adminisztrátor vagy Vezető könyvelő vehet fel."
          )}
        </div>
      )}
      <FoGombKontextus.Provider value={setFoMuvelet}>
        <Outlet />
      </FoGombKontextus.Provider>
    </div>
  );
}
