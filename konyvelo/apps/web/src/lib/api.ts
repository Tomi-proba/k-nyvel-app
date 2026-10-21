import { CSRF_HEADER, type ApiError as ApiErrorBody } from "@konyvelo/shared";

/** A szervertől kapott hiba, mezőnkénti üzenetekkel. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(method !== "GET" ? { [CSRF_HEADER]: "1", "Content-Type": "application/json" } : {}),
      },
      body: method !== "GET" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Nem sikerült kapcsolódni a szerverhez. Ellenőrizze az internetkapcsolatot.");
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // Nem a programunk válaszolt (pl. leállt vagy újraindul a szerver, és a proxy HTML hibaoldalt ad).
  }
  if (!res.ok) {
    const err = (data as { error?: ApiErrorBody } | null)?.error;
    if (!err && res.status >= 500) {
      throw new ApiError(res.status, "UNAVAILABLE", "A szerver most nem érhető el (lehet, hogy újraindul). Várjon egy kicsit, majd frissítse az oldalt.");
    }
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? "Váratlan hiba történt.", err?.fields ?? {});
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body);
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const del = <T>(path: string) => api<T>("DELETE", path);
