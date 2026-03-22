import { NextResponse } from "next/server";

/**
 * HOSPITABLE WEBHOOK ENDPOINT
 *
 * Receives reservation events from Hospitable/Airbnb and triggers
 * auto-scheduling in Convex.
 *
 * Events to handle:
 * - reservation.created → auto-create checkout cleaning job
 * - reservation.updated → reschedule jobs if dates changed
 * - reservation.cancelled → cancel associated jobs
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // TODO: Verify webhook signature
    // TODO: Parse reservation event
    // TODO: Call Convex mutation to auto-create/update jobs

    console.log("Hospitable webhook received:", body.event);

    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
