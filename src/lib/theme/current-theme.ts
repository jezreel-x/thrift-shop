import { cookies } from "next/headers";

import { THEME_COOKIE, type StoredTheme, parseStoredTheme } from "./theme";

/** The stored choice for this request, or null to follow the device. */
export async function getStoredTheme(): Promise<StoredTheme | null> {
  const store = await cookies();

  return parseStoredTheme(store.get(THEME_COOKIE)?.value);
}
