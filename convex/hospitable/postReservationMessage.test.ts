import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReservationMessageRequest } from "./reservationMessages.ts";

test("buildReservationMessageRequest targets the encoded reservation endpoint", () => {
  const request = buildReservationMessageRequest({
    apiKey: "secret",
    baseUrl: "https://public.api.hospitable.com/v2/",
    reservationId: "reservation/123",
    message: "Thanks for staying with us!",
  });

  assert.equal(
    request.url,
    "https://public.api.hospitable.com/v2/reservations/reservation%2F123/messages",
  );
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, JSON.stringify({ body: "Thanks for staying with us!" }));
  assert.equal(
    (request.init.headers as Record<string, string>).Authorization,
    "Bearer secret",
  );
});
