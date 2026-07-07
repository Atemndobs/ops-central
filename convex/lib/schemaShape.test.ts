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
  const registered = Object.keys((schema as unknown as { tables: Record<string, unknown> }).tables);
  for (const name of OWNER_PORTAL_TABLES) {
    assert.ok(
      registered.includes(name),
      `expected table "${name}" to be registered in convex/schema.ts defineSchema({...}) export`,
    );
  }
});

test("schema includes the three owner-portal notification literals", () => {
  const notificationsTable = (schema as unknown as { tables: Record<string, unknown> }).tables.notifications;
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
  const usersTable = (schema as unknown as { tables: Record<string, unknown> }).tables.users;
  assert.ok(
    JSON.stringify(usersTable).includes("owner"),
    "expected users.role union to include \"owner\"",
  );
});

test("incidents schema includes platform suspension and claim tracking fields", () => {
  const incidentsTable = (schema as unknown as { tables: Record<string, unknown> }).tables.incidents;
  const validatorJson = JSON.stringify(incidentsTable);
  for (const field of [
    "platformClaim",
    "affectedPlatform",
    "suspensionStartedAt",
    "suspensionEndedAt",
    "canceledBookingCount",
    "claimFollowUpState",
    "claimFollowUpDueAt",
  ]) {
    assert.ok(
      validatorJson.includes(field),
      `expected incidents table to include "${field}" for platform suspension claim tracking`,
    );
  }

  for (const state of [
    "not_started",
    "collecting_evidence",
    "submitted",
    "awaiting_platform",
    "approved",
    "denied",
    "closed",
  ]) {
    assert.ok(
      validatorJson.includes(state),
      `expected platform claim follow-up state "${state}"`,
    );
  }
});
