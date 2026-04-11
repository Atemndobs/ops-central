# WhatsApp Meta Setup and Testing Runbook

## Purpose

This runbook captures the working Meta Cloud API setup path for OpsCentral's WhatsApp integration so the team can repeat the configuration without rediscovering the steps.

This is for:

- internal testing first
- one WhatsApp sender number
- one WhatsApp Business Account
- a small cleaner rollout

This is not yet the full production-hardening checklist.

## Current Integration Shape

OpsCentral uses the Meta Cloud API through Convex-owned webhook and provider logic.

Relevant code:

- `convex/http.ts`
- `convex/whatsapp/provider.ts`
- `convex/whatsapp/actions.ts`

Current webhook endpoint:

```text
https://usable-anaconda-394.eu-west-1.convex.site/whatsapp/webhook
```

## Required Env Vars

Set these on the active Convex deployment and in local env files:

```env
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_GRAPH_API_VERSION=v23.0
WHATSAPP_BUSINESS_PHONE_E164=
```

Notes:

- `WHATSAPP_ACCESS_TOKEN` is the Meta access token used for Cloud API calls.
- `WHATSAPP_PHONE_NUMBER_ID` is the sender phone number ID from Meta.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` is a random token chosen by us, not provided by Meta.
- `WHATSAPP_APP_SECRET` is the Meta app secret used to verify `X-Hub-Signature-256` on incoming webhook POSTs.
- `WHATSAPP_BUSINESS_PHONE_E164` is the selected WhatsApp sender number in E.164 format.
- `WHATSAPP_GRAPH_API_VERSION` is currently `v23.0`.

## Meta Setup Flow

Use the existing Meta app attached to `J&A Business Solutions`.

Recommended path:

1. Open the existing Meta app.
2. Open the `Connect on WhatsApp` use case.
3. Use one WhatsApp Business Account only.
4. Use one sender phone number only.
5. Generate an access token.
6. Copy the phone number ID from `API Setup`.
7. Use the selected sender number as the `WHATSAPP_BUSINESS_PHONE_E164` value.

For internal testing with a small cleaner team, do not add multiple senders yet. One sender keeps the lane model and webhook behavior simpler.

## Convex Env Setup

Run from the owner backend repo only:

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
```

Set the env vars:

```bash
npx convex env set WHATSAPP_ACCESS_TOKEN "..."
npx convex env set WHATSAPP_PHONE_NUMBER_ID "..."
npx convex env set WHATSAPP_WEBHOOK_VERIFY_TOKEN "..."
npx convex env set WHATSAPP_APP_SECRET "..."
npx convex env set WHATSAPP_GRAPH_API_VERSION "v23.0"
npx convex env set WHATSAPP_BUSINESS_PHONE_E164 "+..."
```

Verify them:

```bash
npx convex env list | rg "WHATSAPP_(ACCESS_TOKEN|PHONE_NUMBER_ID|WEBHOOK_VERIFY_TOKEN|APP_SECRET|GRAPH_API_VERSION|BUSINESS_PHONE_E164)"
```

If webhook validation fails, confirm all five keys exist on the active deployment before retrying Meta.

## Webhook Configuration in Meta

In `Configuration`, use:

- Callback URL: `https://usable-anaconda-394.eu-west-1.convex.site/whatsapp/webhook`
- Verify token: the exact `WHATSAPP_WEBHOOK_VERIFY_TOKEN` value stored in Convex

Then click `Verify and save`.

Important:

- Do not use the Meta access token as the verify token.
- Do not use the shorter `https://usable-anaconda-394.convex.site/...` URL.
- The region-qualified `.eu-west-1.convex.site` URL is the working one in this project.

## Webhook Fields

For the current integration, subscribe:

- `messages`

Do not enable unrelated account-level fields during initial testing.

Optional later:

- `message_template_status_update`

Not required for the current internal message flow:

- `account_alerts`
- `account_review_update`
- `account_settings_update`
- `messaging_handovers`

## What Is Enough For Testing

For internal rollout testing, the following is enough:

- webhook verification succeeds
- `messages` is subscribed
- one sender phone number is configured
- Meta can send a test message
- a phone can reply to that message

At this stage, the team does not need to finish broader production onboarding such as:

- additional sender numbers
- payment method
- broader public rollout approval steps

Those are needed later for production expansion, not for the current five-cleaner internal test path.

## Working Test Sequence

After configuration is complete:

1. Open Meta `API Setup`.
2. Add or select a recipient phone number in the `To` field.
3. Send the Meta test template to that phone.
4. Reply from the phone to the WhatsApp test number.
5. Confirm the inbound webhook reaches Convex.
6. Confirm the inbound message appears in the correct OpsCentral conversation lane.
7. Confirm unread badges update in the UI.
8. Confirm an OpsCentral reply sends back successfully while the service window is open.

## Troubleshooting Notes

### Validation error in Meta webhook config

If Meta says the callback URL or verify token cannot be validated:

1. Check the callback URL exactly.
2. Check the verify token exactly.
3. Confirm the Convex env vars are present.
4. Confirm the backend code has been pushed to the active dev deployment:

```bash
npx convex dev --once --typecheck=disable --tail-logs=disable
```

5. Test the webhook challenge manually:

```bash
curl -i "https://usable-anaconda-394.eu-west-1.convex.site/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=12345"
```

Expected success response:

- HTTP `200`
- body `12345`

### Common failure cause

The most common failure during setup was missing WhatsApp env vars on the active Convex deployment, especially:

- `WHATSAPP_ACCESS_TOKEN`

When that happens, Meta reaches the endpoint, but Convex returns `500` instead of validating the challenge.

## Security Note

If an access token is pasted into chat, screenshots, or any other uncontrolled surface, treat it as exposed and regenerate it.

After regenerating:

1. update the Convex env var
2. update local env if needed
3. continue testing

## Remaining Production Hardening Gap

The webhook POST path verifies Meta's `X-Hub-Signature-256` using `WHATSAPP_APP_SECRET`.

Before broader rollout, confirm this secret is set correctly in every active deployment environment.

## Recommended Next Functional Tests

After setup, run these product tests in OpsCentral:

1. Create or open a job with WhatsApp lane support.
2. Generate the WhatsApp invite link from OpsCentral.
3. Start the lane from the cleaner phone.
4. Confirm the lane is created under the correct job and cleaner.
5. Confirm unread state appears in inbox surfaces.
6. Confirm reply from OpsCentral works.
7. Confirm a second cleaner does not see the first cleaner's lane.
8. Confirm message badges clear after read.
