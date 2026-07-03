import { ReviewsInbox } from "@/components/reviews/reviews-inbox";

export default function ReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reviews</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          AI-drafted replies to guest reviews — approve, edit, or dismiss.
        </p>
      </div>
      <ReviewsInbox />
    </div>
  );
}
