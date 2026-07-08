import { redirect } from "next/navigation";

// Self-service sign-up is disabled — accounts are provisioned internally.
// Any request to /sign-up is sent to the sign-in surface instead.
export default function SignUpPage() {
  redirect("/sign-in");
}
