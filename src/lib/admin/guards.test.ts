import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Fails the build if an admin entry point forgets the guard.
 *
 * Authorisation that depends on remembering is authorisation that will one day
 * be forgotten — JaGedo-style per-route middleware has exactly this failure,
 * and nothing notices a route that simply lacks it. Here, forgetting is a red
 * test.
 *
 * A static check, so it is deliberately blunt: it wants to see the call, not
 * prove it runs. The integration tests prove the guard itself works.
 */

const ROOT = process.cwd();
const GUARD = /\bawait (requirePermission|requireStaff)\(/;

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const adminFiles = [...filesUnder("src/app/admin"), ...filesUnder("src/lib/admin")].filter(
  (file) => !file.includes(".test."),
);

describe("the admin guard", () => {
  it("finds the admin pages it is meant to be checking", () => {
    // Guards against this test passing vacuously because a path moved.
    expect(adminFiles).toContain("src/app/admin/page.tsx");
  });

  const pagesAndRoutes = adminFiles.filter((file) => /\/(page|route)\.tsx?$/.test(file));

  it.each(pagesAndRoutes)("%s checks access before doing anything", (file) => {
    expect(read(file)).toMatch(GUARD);
  });

  // Server Actions are public POST endpoints. Every exported function in a
  // "use server" file is one, whether or not any form uses it.
  const actionFiles = adminFiles.filter((file) => /^\s*["']use server["']/.test(read(file)));

  it.each(actionFiles)("every action in %s checks access", (file) => {
    const actions = read(file)
      .split(/(?=^export async function )/m)
      .slice(1);

    for (const action of actions) {
      const name = /^export async function (\w+)/.exec(action)?.[1];
      expect(action, `${name} does not call requirePermission`).toMatch(
        /\bawait requirePermission\(/,
      );
    }
  });
});
