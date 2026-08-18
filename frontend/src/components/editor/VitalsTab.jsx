import { useMemo } from "react";
import { BookOpenText, Clock, Gauge, TrendingUp, TrendingDown } from "lucide-react";
import { computeBookVitals, formatReadingTime } from "../../utils/bookVitals";

const StatCard = ({ icon: Icon, label, value, sublabel }) => (
  <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex items-start gap-4">
    <div className="w-11 h-11 rounded-2xl bg-accent-muted flex items-center justify-center flex-shrink-0">
      <Icon className="w-5 h-5 text-accent-hover" />
    </div>
    <div className="min-w-0">
      <p className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
      {sublabel && <p className="text-xs text-gray-400 mt-0.5">{sublabel}</p>}
    </div>
  </div>
);

// Client-side "vitals" over the book's already-loaded chapters — total word
// count, estimated reading time, and a per-chapter pacing chart flagging
// chapters that are noticeably shorter/longer than the book's average.
// Nothing here hits the network; useMemo recomputes whenever book.chapters
// changes (generation, manual edits, or Step 19's inline AI edits all
// produce a new chapters array from the parent, so this stays live).
const VitalsTab = ({ book }) => {
  const vitals = useMemo(
    () => computeBookVitals(book?.chapters || []),
    [book?.chapters]
  );

  const hasContent = vitals.totalWords > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 font-serif">Book Vitals</h2>
        <p className="text-gray-500 mt-1">
          A quick read on length and pacing, computed live from your chapters.
        </p>
      </div>

      {!hasContent ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
          Nothing to measure yet — write or generate some chapter content and
          these stats will appear.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              icon={BookOpenText}
              label="Total Words"
              value={vitals.totalWords.toLocaleString()}
            />
            <StatCard
              icon={Clock}
              label="Estimated Reading Time"
              value={formatReadingTime(vitals.readingMinutes)}
              sublabel="~225 words/min"
            />
            <StatCard
              icon={Gauge}
              label="Average Chapter Length"
              value={`${vitals.averageWordCount.toLocaleString()} words`}
            />
          </div>

          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Chapter Pacing</h3>
            <p className="text-sm text-gray-500 mb-6">
              Chapters more than 40% shorter or longer than the book's average
              are flagged below.
            </p>

            <div className="space-y-3">
              {vitals.chapters.map((chapter) => (
                <div key={chapter.index} className="flex items-center gap-4">
                  <div
                    className="w-32 sm:w-44 flex-shrink-0 text-sm text-gray-700 truncate"
                    title={chapter.title}
                  >
                    {chapter.title}
                  </div>

                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        chapter.isOutlier
                          ? "bg-amber-400"
                          : "bg-gradient-to-r from-accent to-accent-secondary"
                      }`}
                      style={{ width: `${chapter.barPercent}%` }}
                    />
                  </div>

                  <div className="w-20 flex-shrink-0 text-right text-sm text-gray-500 tabular-nums">
                    {chapter.wordCount.toLocaleString()}w
                  </div>

                  <div className="w-28 flex-shrink-0">
                    {chapter.isOutlier && (
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          chapter.direction === "long"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                        title={`${chapter.deviationPercent}% ${
                          chapter.direction === "long" ? "longer" : "shorter"
                        } than average`}
                      >
                        {chapter.direction === "long" ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {chapter.direction === "long" ? "Runs long" : "Runs short"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default VitalsTab;
