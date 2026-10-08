import { describe, expect, it } from "vitest";

import { Permission } from "@/generated/prisma/enums";
import { parseRoleForm } from "./role-form";

describe("parseRoleForm", () => {
  it("reads a name, a description and the ticked permissions", () => {
    expect(
      parseRoleForm({
        name: "  Shop   assistant ",
        description: " Sells over the counter. ",
        permissions: [Permission.PRODUCTS_MARK_SOLD, Permission.PRODUCTS_VIEW],
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Shop assistant",
        description: "Sells over the counter.",
        // In the vocabulary's order, whatever order the boxes arrived in.
        permissions: [Permission.PRODUCTS_VIEW, Permission.PRODUCTS_MARK_SOLD],
      },
    });
  });

  it("drops anything that isn't a permission rather than trusting the form", () => {
    const result = parseRoleForm({
      name: "Cashier",
      description: "",
      permissions: ["ORDERS_VIEW", "EVERYTHING"],
    });

    expect(result.ok && result.value).toEqual({
      name: "Cashier",
      description: null,
      permissions: [Permission.ORDERS_VIEW],
    });
  });

  it("needs a name, at least one permission, and not the owner's name", () => {
    expect(parseRoleForm({ name: " ", description: "", permissions: [] })).toEqual({
      ok: false,
      errors: {
        name: "Give the role a name, such as Cashier.",
        permissions: "Tick at least one thing this role may do.",
      },
    });
    expect(
      parseRoleForm({ name: "owner", description: "", permissions: ["ORDERS_VIEW"] }),
    ).toMatchObject({ ok: false, errors: { name: expect.stringMatching(/owner's role/) } });
  });
});
