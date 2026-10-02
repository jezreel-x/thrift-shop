import { Monitor, Moon, Sun } from "lucide-react";

import { setThemeAction } from "@/lib/theme/actions";
import { getStoredTheme } from "@/lib/theme/current-theme";
import type { Theme } from "@/lib/theme/theme";

const OPTIONS: { theme: Theme; label: string; Icon: typeof Sun }[] = [
  { theme: "system", label: "Match device", Icon: Monitor },
  { theme: "light", label: "Light", Icon: Sun },
  { theme: "dark", label: "Dark", Icon: Moon },
];

/**
 * Three buttons, not a toggle.
 *
 * A two-way toggle cannot express "follow my device", and the server — which
 * renders this — cannot know whether a device is dark, so it could not even
 * draw a toggle in the right position. Three explicit choices need neither.
 *
 * One form with a button per option: the pressed button's name and value are
 * what gets submitted, so it works with no JavaScript at all.
 */
export async function ThemeSwitcher() {
  const current: Theme = (await getStoredTheme()) ?? "system";

  return (
    <form
      action={setThemeAction}
      className="flex items-center rounded-lg border border-border p-0.5"
      aria-label="Theme"
    >
      {OPTIONS.map(({ theme, label, Icon }) => (
        <button
          key={theme}
          type="submit"
          name="theme"
          value={theme}
          aria-pressed={current === theme}
          aria-label={label}
          title={label}
          className="rounded-md p-1 text-muted sm:p-1.5 transition hover:text-foreground aria-pressed:bg-surface-muted aria-pressed:text-foreground"
        >
          <Icon aria-hidden className="size-4" />
        </button>
      ))}
    </form>
  );
}
