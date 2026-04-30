import { TaskDetailClient } from "@/components/tasks/task-detail-client";
import type { Id } from "@convex/_generated/dataModel";

// Next.js 16: params is async per project convention
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return <TaskDetailClient taskId={taskId as Id<"opsTasks">} />;
}
