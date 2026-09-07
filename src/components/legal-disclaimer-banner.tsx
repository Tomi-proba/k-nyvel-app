import { DRAFT_STATEMENT_DISCLAIMER } from "@/lib/legal-disclaimer";

/**
 * Jól látható, NEM eltüntethető jogi figyelmeztetés — szándékosan nincs
 * bezáró/elrejtő gomb. Minden nézeten meg kell jelennie, ahol a "Tervezet
 * pénzügyi kimutatás" adatai láthatók (képernyőn ugyanez a szöveg kerül a
 * PDF/Excel exportok elejére is, lásd src/lib/legal-disclaimer.ts).
 */
export function LegalDisclaimerBanner() {
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-5 py-4 text-amber-900">
      <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 flex-shrink-0">
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.28 11.18c.75 1.334-.213 2.987-1.742 2.987H3.72c-1.53 0-2.493-1.653-1.743-2.987l6.28-11.18ZM11 14a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-.25-6.75a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5Z"
            clipRule="evenodd"
          />
        </svg>
        Tervezet — nem hivatalos dokumentum
      </p>
      <p className="mt-1.5 text-sm font-medium leading-relaxed">{DRAFT_STATEMENT_DISCLAIMER}</p>
    </div>
  );
}
