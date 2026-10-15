import { useEffect, useMemo, useRef, useState } from "react";
import { formatNaira } from "../../utils/kenlibsPricing";
import { compactNaira, niceTicks, withRunningTotal } from "../../utils/analyticsSeries";

// Cash revenue over the selected range (admin analytics). Bars per bucket
// (day / week / month), or a running-total line ("cumulative"). Every
// bucket is present even with no sales (the API zero-fills), with a y-axis
// in Naira, x labels thinned to fit, and a tooltip on hover, tap or
// keyboard focus.

const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

const RevenueChart = ({ buckets, cumulative = false }) => {
  const [active, setActive] = useState(null);
  const [width, setWidth] = useState(640);
  const boxRef = useRef(null);
  // Drawn at the container's real pixel width so axis text stays readable
  // on a phone and with a year of daily bars.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const data = useMemo(() => withRunningTotal(buckets), [buckets]);
  const values = data.map((b) => (cumulative ? b.running : b.cash));
  const ticks = niceTicks(Math.max(0, ...values));
  const top = ticks[ticks.length - 1] || 1;

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, data.length);
  const x = (i) => PAD.left + i * slot + slot / 2;
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 64))));

  const linePath = data.map((b, i) => `${i ? "L" : "M"}${x(i)},${y(b.running)}`).join(" ");
  const areaPath = data.length ? `${linePath} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";
  const current = active !== null ? data[active] : null;

  return (
    <div className="relative" ref={boxRef}>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width} height={HEIGHT}
        role="img"
        tabIndex={0}
        aria-label={`${cumulative ? "Cumulative cash revenue over time" : "Cash revenue per period"}. Use the arrow keys to read each period.`}
        aria-describedby={current ? "revenue-chart-tooltip" : undefined}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (!data.length) return;
          const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
          if (!(e.key in moves)) return;
          e.preventDefault();
          const step = moves[e.key];
          const last = data.length - 1;
          setActive((i) => {
            if (!Number.isFinite(step)) return step < 0 ? 0 : last;
            return i === null ? (step < 0 ? last : 0) : Math.min(last, Math.max(0, i + step));
          });
        }}
        className="block w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-gray-100" />
            <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-gray-400 text-[11px]">
              {compactNaira(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} className="stroke-gray-300" />

        {cumulative ? (
          <>
            <path d={areaPath} className="fill-accent/10" />
            <path d={linePath} className="stroke-accent fill-none" strokeWidth={2} />
          </>
        ) : (
          data.map((b, i) => {
            const barW = Math.max(1, Math.min(28, slot * 0.7));
            const h = y(0) - y(b.cash);
            return (
              <rect
                key={b.key}
                x={x(i) - barW / 2}
                y={y(b.cash)}
                width={barW}
                height={Math.max(h, b.cash > 0 ? 2 : 0)}
                rx={2}
                className={active === i ? "fill-accent-hover" : "fill-accent"}
              />
            );
          })
        )}

        {data.map((b, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text key={`label-${b.key}`} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-gray-400 text-[11px]">
              {b.label.replace("Week of ", "")}
            </text>
          ) : null
        )}

        {/* Hit areas for hover and tap. */}
        {data.map((b, i) => (
          <rect
            key={`hit-${b.key}`}
            x={PAD.left + i * slot}
            y={PAD.top}
            width={slot}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setActive(i)}
            onClick={() => setActive(i)}
          />
        ))}
        {current && <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} className="stroke-gray-300" strokeDasharray="3 3" />}
      </svg>

      {current && (
        <div
          id="revenue-chart-tooltip"
          role="status"
          className="pointer-events-none absolute top-0 rounded-xl bg-gray-900 text-white text-xs px-3 py-2 shadow-lg"
          style={{ left: `${Math.min(Math.max((x(active) / width) * 100, 12), 72)}%` }}
        >
          <p className="font-semibold">{current.label}</p>
          <p>
            {formatNaira(current.cash)} cash · {current.orders} order{current.orders === 1 ? "" : "s"}
          </p>
          {current.gross !== current.cash && <p className="text-gray-300">{formatNaira(current.gross)} gross</p>}
          {cumulative && <p className="text-gray-300">Running total {formatNaira(current.running)}</p>}
        </div>
      )}
    </div>
  );
};

export default RevenueChart;
