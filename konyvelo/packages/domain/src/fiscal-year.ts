import { addDays, addMonths, compareDates, endOfMonth, isValidIsoDate, type IsoDate } from "./dates";

/**
 * Üzleti év és időszakok (Szt. 11. §).
 *
 * - Az üzleti év általában 12 naptári hónap; rövidebb lehet (pl. alapítás,
 *   áttérés). Hosszabb csak kivételes esetben (pl. előtársasági időszak,
 *   Szt. 11. § (5)), ezt indoklással kell rögzíteni.
 * - Az üzleti évek nem fedhetik egymást, és folytonosaknak kell lenniük,
 *   hogy a nyitó adatok megegyezhessenek az előző év záró adataival
 *   (folytonosság elve, Szt. 15. § (6)).
 */

export type DateRange = { startDate: IsoDate; endDate: IsoDate };

export type FiscalYearInput = DateRange & { exceptionReason?: string | null };

export type FieldError = { field: string; message: string };

/** A legkésőbbi megengedett záró nap kivétel nélkül: kezdő nap + 12 hónap − 1 nap. */
export function maxRegularEndDate(startDate: IsoDate): IsoDate {
  return addDays(addMonths(startDate, 12), -1);
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return compareDates(a.startDate, b.endDate) <= 0 && compareDates(b.startDate, a.endDate) <= 0;
}

export function validateFiscalYear(input: FiscalYearInput, existing: readonly DateRange[]): FieldError[] {
  const errors: FieldError[] = [];
  const { startDate, endDate } = input;
  const reason = input.exceptionReason?.trim() ?? "";

  if (!isValidIsoDate(startDate)) errors.push({ field: "startDate", message: "Érvénytelen kezdő dátum." });
  if (!isValidIsoDate(endDate)) errors.push({ field: "endDate", message: "Érvénytelen záró dátum (mérlegfordulónap)." });
  if (errors.length) return errors;

  if (compareDates(endDate, startDate) < 0) {
    errors.push({ field: "endDate", message: "A záró dátum nem lehet korábbi a kezdő dátumnál." });
    return errors;
  }

  if (compareDates(endDate, maxRegularEndDate(startDate)) > 0 && reason === "") {
    errors.push({
      field: "endDate",
      message:
        "Az üzleti év legfeljebb 12 hónap lehet. Hosszabb időszak csak kivételes esetben (pl. előtársasági időszak) rögzíthető, indoklással.",
    });
  }

  const overlapping = existing.find((y) => rangesOverlap(y, input));
  if (overlapping) {
    errors.push({ field: "startDate", message: "Az üzleti év átfedésben van egy már rögzített üzleti évvel." });
    return errors;
  }

  if (existing.length > 0) {
    const sorted = [...existing].sort((a, b) => compareDates(a.startDate, b.startDate));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const appendsAfterLast = startDate === addDays(last.endDate, 1);
    const prependsBeforeFirst = endDate === addDays(first.startDate, -1);
    if (!appendsAfterLast && !prependsBeforeFirst) {
      errors.push({
        field: "startDate",
        message: `Az üzleti éveknek folytonosnak kell lenniük. A következő üzleti év kezdő napja: ${addDays(last.endDate, 1)}.`,
      });
    }
  }

  return errors;
}

/** Az üzleti év havi időszakai (az első és az utolsó hónap lehet töredék). */
export function generateMonthlyPeriods(range: DateRange): DateRange[] {
  const periods: DateRange[] = [];
  let start = range.startDate;
  while (compareDates(start, range.endDate) <= 0) {
    const monthEnd = endOfMonth(start);
    const end = compareDates(monthEnd, range.endDate) < 0 ? monthEnd : range.endDate;
    periods.push({ startDate: start, endDate: end });
    start = addDays(end, 1);
  }
  return periods;
}

/** A következő üzleti év javasolt dátumai az előző alapján. */
export function suggestNextFiscalYear(existing: readonly DateRange[], today: IsoDate): DateRange {
  if (existing.length === 0) {
    const year = today.slice(0, 4);
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }
  const last = [...existing].sort((a, b) => compareDates(a.startDate, b.startDate)).at(-1)!;
  const startDate = addDays(last.endDate, 1);
  return { startDate, endDate: maxRegularEndDate(startDate) };
}
