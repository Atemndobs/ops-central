// Convex Auth Configuration for Clerk integration.
// Keep this in sync with the admin app so both clients trust the same issuer.
const clerkIssuer =
  process.env.CLERK_ISSUER_URL ??
  "https://good-bluejay-68.clerk.accounts.dev";

export default {
  providers: [
    {
      domain: clerkIssuer,
      applicationID: "convex",
    },
  ],
};
