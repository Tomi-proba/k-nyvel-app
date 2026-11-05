import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

/** A lekérdezések közös beállítása (önállóan és a keretben is). */
export function ujQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}
