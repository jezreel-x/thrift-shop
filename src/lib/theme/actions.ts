"use server";

import { cookies } from "next/headers";

import { THEME_COOKIE, parseTheme } from "./theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Saves the theme choice.
 *
 * A Server Action behind a plain form, so the switch works before JavaScript
 * loads, or without it. Setting a cookie in an action re-renders the page with
 * the new value, so the change appears without a reload.
 */
export async function setThemeAction(formData: FormData): Promise<void> {
  const theme = parseTheme(formData.get("theme"));
  if (!theme) return;

  const store = await cookies();

  if (theme === "system") {
    store.delete(THEME_COOKIE);
    return;
  }

  store.set(THEME_COOKIE, theme, {
    // Nothing in the browser needs to read it; the server renders it.
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
}
