import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReservationMessageRequest,
  normalizeReservationMessagePage,
} from "./reservationMessages.ts";

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

test("normalizeReservationMessagePage maps the Hospitable thread chronologically", () => {
  const page = normalizeReservationMessagePage({
    data: [
      {
        id: "m2",
        sender_role: "host",
        body: "Your access code is 1234.",
        created_at: "2026-07-02T09:00:00Z",
      },
      {
        id: "m1",
        direction: "inbound",
        body: "Can we check in early?",
        created_at: "2026-07-01T18:00:00Z",
        attachments: [{ url: "https://example.com/photo.jpg" }],
      },
    ],
    meta: { current_page: 1, last_page: 2 },
  });

  assert.equal(page.hasMore, true);
  assert.deepEqual(page.messages.map((message) => message.senderRole), ["host", "guest"]);
  assert.deepEqual(page.messages[1].attachments, ["https://example.com/photo.jpg"]);
});

test("normalizeReservationMessagePage accepts nested message envelopes", () => {
  const page = normalizeReservationMessagePage({
    data: {
      messages: [
        {
          id: "m1",
          sender: { role: "guest" },
          text: "The heating is not working.",
          sent_at: 1_783_000_000,
        },
      ],
    },
  });

  assert.equal(page.messages[0].senderRole, "guest");
  assert.equal(page.messages[0].createdAt, 1_783_000_000_000);
});
