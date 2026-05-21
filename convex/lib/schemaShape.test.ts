import { test } from "node:test";
import assert from "node:assert/strict";
import schema from "../schema.ts";

const OWNER_PORTAL_TABLES = [
  "manualAdjustments",
  "capitalExpenditures",
  "costCategories",
  "costItems",
  "costTemplates",
  "propertyCostItems",
  "monthlyCalculations",
  "propertyMonthlySettings",
  "propertyOwners",
  "propertyFeeConfig",
  "ownerStatements",
  "maintenanceApprovalRequests",
  "ownerDateBlocks",
  "ownerNotificationPrefs",
];

test("owner-portal Wave 1 tables are registered in defineSchema", () => {
  const registered = Object.keys((schema as any).tables);
  for (const name of OWNER_PORTAL_TABLES) {
    assert.ok(
      registered.includes(name),
      `expected table "${name}" to be registered in convex/schema.ts defineSchema({...}) export`,
    );
  }
});

test("schema includes the three owner-portal notification literals", () => {
  const notificationsTable = (schema as any).tables.notifications;
  const validatorJson = JSON.stringify(notificationsTable);
  for (const literal of [
    "owner_statement_issued",
    "owner_approval_request",
    "owner_incident_reported",
  ]) {
    assert.ok(
      validatorJson.includes(literal),
      `expected notifications.type union to include "${literal}"`,
    );
  }
});

test("schema includes the \"owner\" role literal", () => {
  const usersTable = (schema as any).tables.users;
  assert.ok(
    JSON.stringify(usersTable).includes("owner"),
    "expected users.role union to include \"owner\"",
  );
});
