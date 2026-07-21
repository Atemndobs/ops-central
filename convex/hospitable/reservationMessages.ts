export function buildReservationMessageRequest(args: {
  apiKey: string;
  baseUrl: string;
  reservationId: string;
  message: string;
}): { url: string; init: RequestInit } {
  const baseUrl = args.baseUrl.replace(/\/$/, "");
  return {
    url: `${baseUrl}/reservations/${encodeURIComponent(args.reservationId)}/messages`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: args.message }),
    },
  };
}
