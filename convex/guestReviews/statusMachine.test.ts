import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  assertTransition,
  InvalidReviewTransitionError,
} from "./statusMachine.ts";

test("canTransition: needs_draft -> drafted is allowed", () => {
  assert.equal(canTransition("needs_draft", "drafted"), true);
});

test("canTransition: drafted -> sending is allowed", () => {
  assert.equal(canTransition("drafted", "sending"), true);
});

test("canTransition: sending -> sent is allowed", () => {
  assert.equal(canTransition("sending", "sent"), true);
});

test("canTransition: sending -> send_failed is allowed", () => {
  assert.equal(canTransition("sending", "send_failed"), true);
});

test("canTransition: send_failed -> sending is allowed (retry)", () => {
  assert.equal(canTransition("send_failed", "sending"), true);
});

test("canTransition: needs_draft -> dismissed is allowed", () => {
  assert.equal(canTransition("needs_draft", "dismissed"), true);
});

test("canTransition: drafted -> dismissed is allowed", () => {
  assert.equal(canTransition("drafted", "dismissed"), true);
});

test("canTransition: sent -> anything is never allowed (terminal)", () => {
  assert.equal(canTransition("sent", "drafted"), false);
  assert.equal(canTransition("sent", "sending"), false);
  assert.equal(canTransition("sent", "dismissed"), false);
});

test("canTransition: dismissed -> anything is never allowed (terminal)", () => {
  assert.equal(canTransition("dismissed", "drafted"), false);
});

test("canTransition: needs_draft -> sending is not allowed (must draft first)", () => {
  assert.equal(canTransition("needs_draft", "sending"), false);
});

test("assertTransition: throws InvalidReviewTransitionError on illegal transition", () => {
  assert.throws(
    () => assertTransition("sent", "drafted"),
    InvalidReviewTransitionError,
  );
});

test("assertTransition: does not throw on a legal transition", () => {
  assert.doesNotThrow(() => assertTransition("drafted", "sending"));
});
