import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useInternetIdentity } from "../hooks/useInternetIdentity";
import {
  useGetAllFeedback,
  useGetAverageRating,
  useSubmitFeedback,
} from "../hooks/useQueries";

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-3.5 w-3.5 ${
            s <= rating ? "fill-yellow-400 text-yellow-400" : "text-border"
          }`}
        />
      ))}
    </div>
  );
}

export default function FeedbackSection() {
  const { identity } = useInternetIdentity();
  const isAuthenticated = !!identity;
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [review, setReview] = useState("");

  const { data: feedbackList = [] } = useGetAllFeedback();
  const { data: avgRating } = useGetAverageRating();
  const { mutateAsync: submitFeedback, isPending } = useSubmitFeedback();

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      toast.error("Please log in to submit feedback");
      return;
    }
    if (rating === 0) {
      toast.error("Please select a rating");
      return;
    }
    try {
      await submitFeedback({
        rating: BigInt(rating),
        review: review.trim() || null,
      });
      toast.success("Feedback submitted!");
      setRating(0);
      setReview("");
    } catch {
      toast.error("Failed to submit feedback");
    }
  };

  return (
    <section
      className="mt-8 rounded-xl border border-border bg-card p-6"
      data-ocid="feedback.panel"
    >
      <div className="flex items-center gap-2 mb-5">
        <MessageSquare className="h-4 w-4 text-accent" />
        <h3 className="font-semibold text-sm text-foreground">
          Community Feedback
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <StarDisplay rating={Math.round(avgRating ?? 0)} />
          <span className="text-sm font-semibold text-foreground">
            {avgRating != null && avgRating > 0
              ? `${avgRating.toFixed(1)} / 5.0`
              : "N/A"}
          </span>
          <span className="text-xs text-muted-foreground">
            ({feedbackList.length} reviews)
          </span>
        </div>
      </div>

      {/* Submit form */}
      <div className="mb-6 p-4 rounded-lg bg-background border border-border">
        <p className="text-xs text-muted-foreground mb-3">
          {isAuthenticated
            ? "Rate your experience"
            : "Log in to leave a review"}
        </p>
        <div className="flex gap-1 mb-3" data-ocid="feedback.rating">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => isAuthenticated && setRating(s)}
              onMouseEnter={() => isAuthenticated && setHovered(s)}
              onMouseLeave={() => setHovered(0)}
              disabled={!isAuthenticated}
              className="transition-transform hover:scale-110 disabled:cursor-not-allowed"
              aria-label={`Rate ${s} stars`}
            >
              <Star
                className={`h-6 w-6 transition-colors ${
                  s <= (hovered || rating)
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-border hover:text-yellow-300"
                }`}
              />
            </button>
          ))}
        </div>
        <Textarea
          placeholder="Optional review (max 500 chars)…"
          value={review}
          onChange={(e) => setReview(e.target.value.slice(0, 500))}
          disabled={!isAuthenticated}
          rows={2}
          className="mb-3 bg-input border-border text-sm resize-none"
          data-ocid="feedback.textarea"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!isAuthenticated || isPending || rating === 0}
          className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
          data-ocid="feedback.submit_button"
        >
          {isPending ? (
            <span className="h-3.5 w-3.5 border border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Submit
        </Button>
      </div>

      {/* Review list */}
      {feedbackList.length === 0 ? (
        <p
          className="text-xs text-muted-foreground text-center py-4"
          data-ocid="feedback.empty_state"
        >
          No reviews yet. Be the first!
        </p>
      ) : (
        <div
          className="space-y-3 max-h-64 overflow-y-auto"
          data-ocid="feedback.list"
        >
          {feedbackList.slice(0, 20).map((fb, i) => (
            <div
              key={`${fb.user.toString()}-${String(fb.timestamp)}`}
              className="p-3 rounded-lg bg-background border border-border"
              data-ocid={`feedback.item.${i + 1}`}
            >
              <div className="flex items-center justify-between mb-1">
                <StarDisplay rating={Number(fb.rating)} />
                <span className="text-xs font-mono text-muted-foreground">
                  {fb.user.toString().slice(0, 10)}…
                </span>
              </div>
              {fb.review && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {fb.review}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
