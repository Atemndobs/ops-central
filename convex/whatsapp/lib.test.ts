import { describe, expect, test } from "vitest";

import {
  WHATSAPP_SERVICE_WINDOW_MS,
  buildAttachmentPlaceholder,
  buildWhatsAppInvitePrefillText,
  extractWhatsAppInviteToken,
  getAttachmentKindFromMimeType,
  getWhatsAppServiceWindowClosesAt,
  isWhatsAppServiceWindowOpen,
  normalizeWhatsAppPhoneNumber,
} from "./lib";

describe("normalizeWhatsAppPhoneNumber", () => {
  test("returns E.164-like numbers", () => {
    expect(normalizeWhatsAppPhoneNumber(" +1 (555) 123-4567 ")).toBe("+15551234567");
    expect(normalizeWhatsAppPhoneNumber("4917612345678")).toBe("+4917612345678");
    expect(normalizeWhatsAppPhoneNumber("abc")).toBeNull();
  });
});

describe("invite token parsing", () => {
  test("round-trips through prefill text", () => {
    const text = buildWhatsAppInvitePrefillText({
      token: "abc123DEF456ghi789",
      propertyName: "Lake House",
    });

    expect(extractWhatsAppInviteToken(text)).toBe("abc123DEF456ghi789");
    expect(extractWhatsAppInviteToken("hello there")).toBeNull();
  });
});

describe("service window logic", () => {
  test("uses the 24-hour rule", () => {
    const inboundAt = 1_700_000_000_000;
    const closesAt = getWhatsAppServiceWindowClosesAt(inboundAt);

    expect(closesAt).toBe(inboundAt + WHATSAPP_SERVICE_WINDOW_MS);
    expect(isWhatsAppServiceWindowOpen(closesAt, closesAt - 1)).toBe(true);
    expect(isWhatsAppServiceWindowOpen(closesAt, closesAt)).toBe(false);
  });
});

describe("attachment helpers", () => {
  test("distinguish supported whatsapp media", () => {
    expect(getAttachmentKindFromMimeType("image/jpeg")).toBe("image");
    expect(getAttachmentKindFromMimeType("application/pdf")).toBe("document");
    expect(getAttachmentKindFromMimeType("audio/ogg")).toBeNull();
  });

  test("build placeholder text from caption or filename", () => {
    expect(
      buildAttachmentPlaceholder({ attachmentKind: "image", caption: "Kitchen sink" }),
    ).toBe("Kitchen sink");
    expect(
      buildAttachmentPlaceholder({ attachmentKind: "document", fileName: "checklist.pdf" }),
    ).toBe("checklist.pdf");
  });
});
