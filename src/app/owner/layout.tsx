import type { Metadata } from "next";
import { OwnerShell } from "@/components/owner/owner-shell";

export const metadata: Metadata = {
  title: "Owner Portal — J&A Business Solutions",
  description:
    "Radical financial transparency for property owners. Every line on your statement is a clickable receipt.",
};

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <OwnerShell>{children}</OwnerShell>;
}
