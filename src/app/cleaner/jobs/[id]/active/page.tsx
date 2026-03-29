import { CleanerActiveJobClient } from "@/components/cleaner/cleaner-active-job-client";

export default async function CleanerActiveJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CleanerActiveJobClient id={id} />;
}
