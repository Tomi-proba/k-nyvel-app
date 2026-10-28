import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { ROLE_LABELS } from "@konyvelo/shared";
import { post } from "../lib/api";
import { fiscalYearLabel } from "../lib/format";
import { Tooltip } from "../ui/Tooltip";
import { NEW_ENTRY_SHORTCUT_TEXT, ShortcutHelpDialog, useGlobalShortcuts } from "./shortcuts";
import { ThemeToggle } from "./theme";
import { useWorkspace } from "./workspace";

/** A 6 főmenüpont (PLAN 5.1). */
const MAIN_MENU = [
  { to: "/", label: "Kezdőlap", end: true },
  { to: "/konyveles", label: "Könyvelés" },
  { to: "/partnerek", label: "Partnerek" },
  { to: "/kimutatasok", label: "Kimutatások" },
  { to: "/zaras", label: "Zárás" },
  { to: "/beallitasok", label: "Beállítások" },
];

export const NEW_ENTRY_PATH = "/konyveles/uj";

export function AppLayout() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [helpOpen, setHelpOpen] = useState(false);

  useGlobalShortcuts({
    onNewEntry: () => navigate(NEW_ENTRY_PATH),
    onHelp: () => setHelpOpen(true),
  });

  return (
    <>
      <a href="#tartalom" className="skip-link">
        Ugrás a tartalomra
      </a>
      <header className="app-header">
        <NavLink to="/" className="brand">
          Könyvelő
        </NavLink>

        <div className="header-selects">
          {ws.me.companies.length > 0 && (
            <>
              <label className="sr-only" htmlFor="company-select">
                Cég
              </label>
              <select
                id="company-select"
                className="input-compact"
                value={ws.company?.id ?? ""}
                onChange={(e) => ws.selectCompany(e.target.value)}
              >
                {ws.me.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName} ({ROLE_LABELS[c.role]})
                  </option>
                ))}
              </select>
            </>
          )}
          {ws.fiscalYears.length > 0 && (
            <>
              <label className="sr-only" htmlFor="fy-select">
                Üzleti év
              </label>
              <select
                id="fy-select"
                className="input-compact"
                value={ws.fiscalYear?.id ?? ""}
                onChange={(e) => ws.selectFiscalYear(e.target.value)}
              >
                {ws.fiscalYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    Üzleti év: {fiscalYearLabel(y)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="header-spacer" />

        <div className="header-actions">
          <Tooltip content={<>Új tétel rögzítése – {NEW_ENTRY_SHORTCUT_TEXT}</>}>
            <button
              type="button"
              className="btn btn-primary"
              aria-label="Új tétel"
              aria-keyshortcuts="Alt+N F2 N"
              onClick={() => navigate(NEW_ENTRY_PATH)}
            >
              <span aria-hidden="true">+</span>
              <span className="new-entry-label" aria-hidden="true">
                Új tétel
              </span>
            </button>
          </Tooltip>
          <NavLink to="/sugo" className="btn btn-small">
            Súgó
          </NavLink>
          <Tooltip content="Gyorsbillentyűk listája (?)">
            <button type="button" className="btn btn-icon" aria-label="Gyorsbillentyűk listája" aria-keyshortcuts="?" onClick={() => setHelpOpen(true)}>
              <span aria-hidden="true">⌨</span>
            </button>
          </Tooltip>
          <ThemeToggle />
          <Tooltip content={ws.me.user.email}>
            <span className="muted" tabIndex={0}>
              {ws.me.user.name}
            </span>
          </Tooltip>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              await post("/api/auth/logout").catch(() => {});
              queryClient.clear();
              navigate("/");
              await queryClient.invalidateQueries();
            }}
          >
            Kilépés
          </button>
        </div>
      </header>

      <nav className="main-nav" aria-label="Főmenü">
        <ul>
          {MAIN_MENU.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main id="tartalom">
        <Outlet />
      </main>

      <ShortcutHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
