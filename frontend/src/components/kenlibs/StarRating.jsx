import { useState } from "react";
import { Star } from "lucide-react";

const SIZE_CLASSES = {
  xs: "w-3 h-3",
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-7 h-7",
};

// Shared display + input star row (Step 44) — `interactive` switches
// between a plain read-only display (storefront cards, the aggregate
// summary, other readers' review cards) and a click-to-rate input (the
// "Rate this book" form). Hover state is self-contained so callers never
// need to manage it themselves.
const StarRating = ({ value = 0, size = "sm", interactive = false, onChange }) => {
  const [hoverValue, setHoverValue] = useState(null);
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.sm;
  const displayValue = interactive && hoverValue != null ? hoverValue : value;

  return (
    <div
      className="flex items-center gap-0.5"
      onMouseLeave={interactive ? () => setHoverValue(null) : undefined}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.round(displayValue);
        const icon = (
          <Star
            className={`${sizeClass} ${filled ? "fill-accent text-accent" : "fill-none text-gray-300"}`}
          />
        );

        return interactive ? (
          <button
            key={star}
            type="button"
            onClick={() => onChange?.(star)}
            onMouseEnter={() => setHoverValue(star)}
            className="cursor-pointer transition-transform hover:scale-110"
            aria-label={`Rate ${star} star${star === 1 ? "" : "s"}`}
          >
            {icon}
          </button>
        ) : (
          <span key={star}>{icon}</span>
        );
      })}
    </div>
  );
};

export default StarRating;
