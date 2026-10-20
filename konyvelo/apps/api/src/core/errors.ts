import type { z } from "zod";
import { fieldErrorsFromZod, type ApiError } from "@konyvelo/shared";

/** Felhasználónak szóló, magyar nyelvű hiba megfelelő HTTP-kóddal. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }

  toJSON(): { error: ApiError } {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

export const unauthorized = () =>
  new AppError(401, "UNAUTHENTICATED", "A művelethez be kell jelentkeznie.");

export const forbidden = (message = "Ehhez a művelethez nincs jogosultsága.") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "A keresett adat nem található.") => new AppError(404, "NOT_FOUND", message);

export const conflict = (message: string, fields?: Record<string, string>) =>
  new AppError(409, "CONFLICT", message, fields);

export const validationError = (fields: Record<string, string>, message = "Kérjük, javítsa a megjelölt mezőket.") =>
  new AppError(422, "VALIDATION", message, fields);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Útvonal-paraméterben kapott azonosító ellenőrzése (hibás formánál 404). */
export function assertUuid(id: string, message?: string): void {
  if (!UUID_RE.test(id)) throw notFound(message);
}

/** A kérés törzsének ellenőrzése Zod sémával; hiba esetén mezőnkénti magyar üzenetek. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw validationError(fieldErrorsFromZod(r.error));
  return r.data;
}
