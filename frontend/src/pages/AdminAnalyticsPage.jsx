import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  BarChart3,
  Wallet,
  Users,
  TrendingUp,
  Gift,
  Loader2,
  ShieldCheck,
  Bug,
  Headphones,
  Languages,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertTriangle,
  FlaskConical,
  Scale,
} from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import RevenueChart from "../components/admin/RevenueChart";
import { formatNaira } from "../utils/kenlibsPricing";
import { bucketSeries, trendOf, isSmallSample } from "../utils/analyticsSeries";

// Admin analytics (backend/controller/analyticsController.js has the exact
// definitions). Revenue is cash received (price minus store credit used),
// counted when a purchase is approved, in Lagos days. Everything is for the
// chosen range and compared with the previous range of the same length.

const lagosToday = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
const shiftDay = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
};
const PRESETS = [
  ["7d", "7 days", 7],
  ["30d", "30 days", 30],
  ["90d", "90 days", 90],
  ["12m", "12 months", 365],
  ["all", "All time", null],
];
const formatDay = (day) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const formatWhen = (iso) =>
  new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const waitingFor = (iso) => {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
};

const TREND_STYLES = {
  up: ["bg-emerald-50 text-emerald-700", ArrowUpRight],
  down: ["bg-red-50 text-red-700", ArrowDownRight],
  new: ["bg-emerald-50 text-emerald-700", ArrowUpRight],
  flat: ["bg-gray-100 text-gray-600", Minus],
  none: ["bg-gray-100 text-gray-500", Minus],
};

const TrendChip = ({ trend, title }) => {
  const [style, Icon] = TREND_STYLES[trend.direction] || TREND_STYLES.none;
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold ${style}`} title={title}>
      {trend.direction !== "none" && <Icon className="w-3 h-3" />}
      {trend.label}
    </span>
  );
};

const SampleWarning = ({ n, noun = "readers" }) =>
  isSmallSample(n) ? (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700" title="Too few to be reliable yet">
      <AlertTriangle className="w-3 h-3" /> based on {n} {noun}
    </span>
  ) : null;

const Card = ({ className = "", children }) => (
  <div className={`min-w-0 bg-white rounded-3xl border border-gray-100 shadow-sm p-5 sm:p-6 ${className}`}>{children}</div>
);

const KpiCard = ({ icon: Icon, label, value, trend, trendTitle, children }) => (
  <Card>
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="w-10 h-10 rounded-2xl bg-accent-50 flex items-center justify-center">
        <Icon className="w-5 h-5 text-accent" />
      </div>
      {trend && <TrendChip trend={trend} title={trendTitle} />}
    </div>
    <p className="text-sm text-gray-500">{label}</p>
    <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
    {children && <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">{children}</div>}
  </Card>
);

const AttentionItem = ({ to, icon: Icon, label, detail, active }) => (
  <Link
    to={to}
    className={`flex items-start gap-3 rounded-2xl border p-4 transition-colors ${
      active ? "border-amber-200 bg-amber-50 hover:bg-amber-100" : "border-gray-100 bg-white hover:bg-gray-50"
    }`}
  >
    <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${active ? "text-amber-700" : "text-gray-400"}`} />
    <div className="min-w-0">
      <p className={`text-sm font-semibold ${active ? "text-amber-900" : "text-gray-600"}`}>{label}</p>
      <p className="text-xs text-gray-500 mt-0.5 truncate">{detail}</p>
    </div>
  </Link>
);

const NeedsAttention = ({ attention }) => {
  if (!attention) return null;
  const { pendingPurchases, unresolvedErrors, failedAudio, failedTranslations, licences } = attention;
  const jobBook = (summary) => summary.books[0]?.bookId;
  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="text-sm font-semibold text-gray-700 mb-2">
        Needs attention
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AttentionItem
          to="/admin/purchases"
          icon={ShieldCheck}
          active={pendingPurchases.count > 0}
          label={`${pendingPurchases.count} pending purchase request${pendingPurchases.count === 1 ? "" : "s"}`}
          detail={pendingPurchases.oldestCreatedAt ? `Oldest waiting ${waitingFor(pendingPurchases.oldestCreatedAt)}` : "Nothing waiting"}
        />
        <AttentionItem
          to="/admin/errors"
          icon={Bug}
          active={unresolvedErrors > 0}
          label={`${unresolvedErrors} unresolved error${unresolvedErrors === 1 ? "" : "s"}`}
          detail={unresolvedErrors ? "Open the Errors page" : "All clear"}
        />
        <AttentionItem
          to={jobBook(failedAudio) ? `/editor/${jobBook(failedAudio)}` : "/dashboard"}
          icon={Headphones}
          active={failedAudio.count > 0}
          label={`${failedAudio.count} audio chapter${failedAudio.count === 1 ? "" : "s"} failed or waiting`}
          detail={failedAudio.books.length ? failedAudio.books.map((b) => b.title).join(", ") : "No narration problems"}
        />
        <AttentionItem
          to={jobBook(failedTranslations) ? `/editor/${jobBook(failedTranslations)}` : "/dashboard"}
          icon={Languages}
          active={failedTranslations.count > 0}
          label={`${failedTranslations.count} translation${failedTranslations.count === 1 ? "" : "s"} failed or waiting`}
          detail={failedTranslations.books.length ? failedTranslations.books.map((b) => `${b.title} (${b.languages.join(", ")})`).join(", ") : "No translation problems"}
        />
        {licences && (
          <AttentionItem
            to={licences.books[0] ? `/editor/${licences.books[0].bookId}` : "/dashboard"}
            icon={Scale}
            active={licences.count > 0}
            label={`${licences.count} licence${licences.count === 1 ? "" : "s"} expired or expiring`}
            detail={licences.books.length ? licences.books.map((b) => `${b.title} (${b.status === "expired" ? "expired" : "expiring"}${b.published ? ", published" : ""})`).join(", ") : "No licence problems"}
          />
        )}
      </div>
    </section>
  );
};

const Toggle = ({ options, value, onChange, label }) => (
  <div className="inline-flex gap-1 bg-gray-100 rounded-2xl p-1" role="group" aria-label={label}>
    {options.map(([key, text]) => (
      <button
        key={key}
        type="button"
        aria-pressed={value === key}
        onClick={() => onChange(key)}
        className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
          value === key ? "bg-white text-accent-hover shadow-sm" : "text-gray-600 hover:text-gray-900"
        }`}
      >
        {text}
      </button>
    ))}
  </div>
);

const Funnel = ({ funnel }) => {
  const stages = [
    ["Book page views", funnel.views, funnel.trackingEnabled ? null : "View tracking is off"],
    ["Sign-ups", funnel.signups],
    ["Purchase requests", funnel.requests],
    ["Approved", funnel.approved],
  ];
  const max = Math.max(1, ...stages.map(([, n]) => n || 0));
  return (
    <div className="space-y-3">
      {stages.map(([label, count, note], i) => {
        const previous = i > 0 ? stages[i - 1][1] : null;
        const rate = previous ? Math.round((count / previous) * 1000) / 10 : null;
        return (
          <div key={label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-700">{label}</span>
              <span className="font-semibold text-gray-900 tabular-nums">{note ? "—" : count.toLocaleString("en-NG")}</span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 mt-1 overflow-hidden">
              <div className="h-full rounded-full bg-accent" style={{ width: `${note ? 0 : Math.max(count ? 2 : 0, (count / max) * 100)}%` }} />
            </div>
            {rate !== null && (
              <p className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                <span>
                  {rate > 100
                    ? "more than the step before (includes people who signed up earlier)"
                    : `${rate}% of the step before`}
                </span>
                <SampleWarning n={previous} noun={stages[i - 1][0].toLowerCase()} />
              </p>
            )}
          </div>
        );
      })}
      <p className="text-xs text-gray-500 pt-1">
        {!funnel.trackingEnabled
          ? "Book page views aren't being counted (BOOK_VIEW_TRACKING_ENABLED=false)."
          : funnel.trackingStartedOn
            ? `Views are counted from ${formatDay(funnel.trackingStartedOn)}; there is no view data before that.`
            : "Views will appear once someone opens a book page; there is no view history from before tracking started."}{" "}
        Each stage counts what happened in this period, so they're totals, not the same people followed through.
      </p>
    </div>
  );
};

const AdminAnalyticsPage = () => {
  const [preset, setPreset] = useState("30d");
  const [customFrom, setCustomFrom] = useState(() => shiftDay(lagosToday(), -29));
  const [customTo, setCustomTo] = useState(lagosToday);
  const [hideTest, setHideTest] = useState(false);
  const [minPrice, setMinPrice] = useState(100);
  const [granularity, setGranularity] = useState("day");
  const [cumulative, setCumulative] = useState(false);
  const [bookSort, setBookSort] = useState("cash");
  const [data, setData] = useState(null);
  const [attention, setAttention] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const query = useMemo(() => {
    const params = {};
    if (preset === "all") params.range = "all";
    else if (preset === "custom") Object.assign(params, { from: customFrom, to: customTo });
    else {
      const days = PRESETS.find(([key]) => key === preset)[2];
      Object.assign(params, { from: shiftDay(lagosToday(), -(days - 1)), to: lagosToday() });
    }
    if (hideTest) Object.assign(params, { hideTest: "1", minPrice: String(minPrice) });
    return params;
  }, [preset, customFrom, customTo, hideTest, minPrice]);

  const load = useCallback(
    () =>
      axiosInstance
        .get(API_PATHS.ADMIN.ANALYTICS, { params: query })
        .then((res) => setData(res.data))
        .catch((error) => toast.error(getErrorMessage(error, "Couldn't load analytics.")))
        .finally(() => setIsLoading(false)),
    [query]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    axiosInstance
      .get(API_PATHS.ADMIN.ATTENTION)
      .then((res) => setAttention(res.data))
      .catch(() => setAttention(null));
  }, []);

  const changeQuery = (apply) => {
    setIsLoading(true);
    apply();
  };

  const buckets = useMemo(() => (data ? bucketSeries(data.revenueSeries, granularity) : []), [data, granularity]);
  const topBooks = useMemo(
    () => [...(data?.topBooks || [])].sort((a, b) => (bookSort === "orders" ? b.orders - a.orders || b.cash - a.cash : b.cash - a.cash || b.orders - a.orders)),
    [data, bookSort]
  );

  const kpis = data?.kpis;
  const previousLabel = data ? `vs ${formatDay(data.range.previousFrom)} – ${formatDay(data.range.previousTo)}` : "";

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-accent" />
              Analytics
            </h1>
            <p className="text-gray-500 mt-1 text-sm">
              {data ? `${formatDay(data.range.from)} – ${formatDay(data.range.to)} (Lagos time), compared with the previous ${data.range.days} days.` : "Loading…"}
            </p>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="overflow-x-auto max-w-full">
                <Toggle
                  label="Date range"
                  value={preset}
                  onChange={(key) => changeQuery(() => setPreset(key))}
                  options={[...PRESETS.map(([key, text]) => [key, text]), ["custom", "Custom"]]}
                />
              </div>
              {preset === "custom" && (
                <div className="flex items-center gap-2 text-sm">
                  <label className="sr-only" htmlFor="range-from">From</label>
                  <input id="range-from" type="date" value={customFrom} max={customTo} onChange={(e) => e.target.value && changeQuery(() => setCustomFrom(e.target.value))} className="bg-white border border-gray-200 rounded-xl px-2.5 py-1.5" />
                  <span className="text-gray-400">to</span>
                  <label className="sr-only" htmlFor="range-to">To</label>
                  <input id="range-to" type="date" value={customTo} min={customFrom} max={lagosToday()} onChange={(e) => e.target.value && changeQuery(() => setCustomTo(e.target.value))} className="bg-white border border-gray-200 rounded-xl px-2.5 py-1.5" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={hideTest} onChange={(e) => changeQuery(() => setHideTest(e.target.checked))} className="w-4 h-4 accent-[var(--color-accent)]" />
                <span className="font-medium text-gray-700">Hide test data</span>
              </label>
              {hideTest && (
                <label className="inline-flex items-center gap-1.5 text-gray-600">
                  under
                  <span className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">₦</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={minPrice}
                      onChange={(e) => changeQuery(() => setMinPrice(Math.max(0, Number(e.target.value) || 0)))}
                      className="w-24 bg-white border border-gray-200 rounded-xl pl-6 pr-2 py-1.5"
                      aria-label="Leave out purchases cheaper than"
                    />
                  </span>
                </label>
              )}
            </div>
          </div>

          {data?.testData.hidden && (
            <p className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
              <FlaskConical className="w-4 h-4 mt-0.5 flex-shrink-0" />
              Test data hidden: purchases under {formatNaira(data.testData.minPrice)}, and everything from admin and test
              accounts ({data.testData.excludedAccounts}), are left out of every number below. Flag test accounts on the
              Users page.
            </p>
          )}
        </div>

        <NeedsAttention attention={attention} />

        {!data ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
          </div>
        ) : (
          <div className={`space-y-6 transition-opacity ${isLoading ? "opacity-60" : ""}`}>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                icon={Wallet}
                label="Cash received"
                value={formatNaira(kpis.cashRevenue.value)}
                trend={trendOf(kpis.cashRevenue.value, kpis.cashRevenue.previous)}
                trendTitle={`${formatNaira(kpis.cashRevenue.previous)} ${previousLabel}`}
              >
                <p>
                  Gross sales {formatNaira(kpis.grossSales.value)} · store credit used {formatNaira(kpis.creditApplied.value)}
                </p>
                <p>
                  {kpis.orders.value} approved order{kpis.orders.value === 1 ? "" : "s"} (was {kpis.orders.previous})
                </p>
              </KpiCard>
              <KpiCard
                icon={Users}
                label="Readers"
                value={kpis.readers.total.toLocaleString("en-NG")}
                trend={trendOf(kpis.readers.total, kpis.readers.previousTotal)}
                trendTitle={`${kpis.readers.previousTotal} at the start of this period`}
              >
                <p>
                  +{kpis.readers.newInRange} new in this period (was +{kpis.readers.newPrevious})
                </p>
              </KpiCard>
              <KpiCard
                icon={TrendingUp}
                label="Conversion (readers who have bought)"
                value={`${kpis.conversion.ratePercent}%`}
                trend={trendOf(kpis.conversion.ratePercent, kpis.conversion.previousRatePercent, { mode: "points" })}
                trendTitle={`${kpis.conversion.previousRatePercent}% at the start of this period`}
              >
                <p>
                  {kpis.conversion.converted} of {kpis.conversion.sample} readers
                </p>
                <SampleWarning n={kpis.conversion.sample} />
              </KpiCard>
              <KpiCard
                icon={Gift}
                label="Referral credit granted"
                value={formatNaira(kpis.referralCredit.grantedInRange)}
                trend={trendOf(kpis.referralCredit.grantedInRange, kpis.referralCredit.grantedPrevious)}
                trendTitle={`${formatNaira(kpis.referralCredit.grantedPrevious)} ${previousLabel}`}
              >
                <p>
                  {kpis.referralCredit.conversionsInRange} referral{kpis.referralCredit.conversionsInRange === 1 ? "" : "s"} ·{" "}
                  {formatNaira(kpis.referralCredit.outstandingNow)} unspent now
                </p>
              </KpiCard>
            </div>

            <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h2 className="font-semibold text-gray-900">Cash revenue</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <Toggle
                      label="Group by"
                      value={granularity}
                      onChange={setGranularity}
                      options={[
                        ["day", "Daily"],
                        ["week", "Weekly"],
                        ["month", "Monthly"],
                      ]}
                    />
                    <Toggle
                      label="Chart"
                      value={cumulative ? "cumulative" : "per"}
                      onChange={(key) => setCumulative(key === "cumulative")}
                      options={[
                        ["per", "Per period"],
                        ["cumulative", "Cumulative"],
                      ]}
                    />
                  </div>
                </div>
                <RevenueChart buckets={buckets} cumulative={cumulative} />
              </Card>

              <Card>
                <h2 className="font-semibold text-gray-900 mb-3">Recent sales</h2>
                {data.recentSales.length === 0 ? (
                  <p className="text-sm text-gray-400">No approved sales in this period.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {data.recentSales.map((sale) => (
                      <li key={sale.id} className="py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium truncate ${sale.deleted ? "text-gray-500 italic" : "text-gray-900"}`}>{sale.title}</p>
                          <p className="text-xs text-gray-400">
                            {sale.itemType === "bundle" ? "Bundle · " : ""}
                            {formatWhen(sale.approvedAt)}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatNaira(sale.cash)}</p>
                          {sale.cash !== sale.amount && <p className="text-xs text-gray-400">of {formatNaira(sale.amount)}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <h2 className="font-semibold text-gray-900 mb-4">Funnel</h2>
                <Funnel funnel={data.funnel} />
              </Card>
              <Card>
                <h2 className="font-semibold text-gray-900 mb-1">Purchase requests by status</h2>
                <p className="text-xs text-gray-400 mb-3">Requests made in this period, by where they are now.</p>
                <dl className="space-y-2 text-sm">
                  {[
                    ["Pending", data.statusBreakdown.pending],
                    ["Approved", data.statusBreakdown.approved],
                    ["Rejected", data.statusBreakdown.rejected],
                    ["Revoked", data.statusBreakdown.revoked],
                  ].map(([label, count]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-gray-600">{label}</dt>
                      <dd className="font-semibold text-gray-900 tabular-nums">{count}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-gray-100 pt-2">
                    <dt className="text-gray-600">Total</dt>
                    <dd className="font-semibold text-gray-900 tabular-nums">{data.statusBreakdown.total}</dd>
                  </div>
                </dl>
              </Card>
            </div>

            <Card className="!p-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 pt-5">
                <h2 className="font-semibold text-gray-900">Top books</h2>
                <Toggle
                  label="Sort by"
                  value={bookSort}
                  onChange={setBookSort}
                  options={[
                    ["cash", "By revenue"],
                    ["orders", "By orders"],
                  ]}
                />
              </div>
              {topBooks.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-400">No book sales in this period.</p>
              ) : (
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <tr>
                        <th className="px-5 sm:px-6 py-3">Book</th>
                        <th className="px-4 py-3 text-right" aria-sort={bookSort === "orders" ? "descending" : undefined}>Orders</th>
                        <th className="px-4 py-3 text-right" aria-sort={bookSort === "cash" ? "descending" : undefined}>Revenue</th>
                        <th className="px-5 sm:px-6 py-3 text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {topBooks.map((book) => (
                        <tr key={book.id}>
                          <td className={`px-5 sm:px-6 py-3 ${book.deleted ? "text-gray-500 italic" : "text-gray-900 font-medium"}`}>{book.title}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{book.orders}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNaira(book.cash)}</td>
                          <td className="px-5 sm:px-6 py-3 text-right tabular-nums text-gray-600">{book.sharePercent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.topBundles.length > 0 && (
                <div className="border-t border-gray-100">
                  <h3 className="px-5 sm:px-6 pt-4 text-sm font-semibold text-gray-700">Bundles</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm mt-2">
                      <tbody className="divide-y divide-gray-100">
                        {data.topBundles.map((bundle) => (
                          <tr key={bundle.id}>
                            <td className={`px-5 sm:px-6 py-3 ${bundle.deleted ? "text-gray-500 italic" : "text-gray-900 font-medium"}`}>{bundle.title}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{bundle.orders}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatNaira(bundle.cash)}</td>
                            <td className="px-5 sm:px-6 py-3 text-right tabular-nums text-gray-600">{bundle.sharePercent}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <p className="px-5 sm:px-6 py-3 text-xs text-gray-400 border-t border-gray-100">
                Revenue is cash received from approved purchases in this period; share is of all cash, bundles included.
              </p>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminAnalyticsPage;
