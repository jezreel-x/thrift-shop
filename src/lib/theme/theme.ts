/**
 * The visitor's theme preference.
 *
 * "system" is not stored. Its absence is the preference: returning to it
 * deletes the cookie, so the default can never be a stale copy of itself.
 */

export const THEME_COOKIE = "thrift_theme";

export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/** A stored choice, or null meaning "follow the device". */
export type StoredTheme = Exclude<Theme, "system">;

/** Reads the cookie leniently: anything unexpected means "follow the device". */
export function parseStoredTheme(value: string | undefined): StoredTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Reads a submitted choice strictly: only the three real options. */
export function parseTheme(value: unknown): Theme | null {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
    ? (value as Theme)
    : null;
}
