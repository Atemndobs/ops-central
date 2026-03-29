"use client";

import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { usePathname } from "next/navigation";

export function GlobalAuthHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith("/cleaner")) {
    return null;
  }

  return (
    <header className="flex items-center justify-end gap-3 border-b bg-[var(--card)] px-4 py-3">
      <Show when="signed-out">
        <SignInButton />
        <SignUpButton />
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </header>
  );
}
