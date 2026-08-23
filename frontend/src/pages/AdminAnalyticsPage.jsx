import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  BarChart3,
  Loader2,
  Wallet,
  Users,
  TrendingUp,
  Gift,
  BookOpen,
  Package,
} from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import { formatNaira } from "../utils/kenlibsPricing";

const DAYS_OF_HISTORY = 30;

// No charting library exists anywhere in package.json (checked before
// writing this) — a 30-point daily bar chart is simple enough to hand-roll
// as plain SVG rather than pull in a new dependency for one chart.
const RevenueBarChart = ({ series }) => {
  const max = Math.max(1, ...series.map((d) => d.revenue));
  const width = 720;
  const height = 160;
  const barGap = 2;
  const barWidth = width / series.length - barGap;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40" preserveAspectRatio="none">
      {series.map((d, i) => {
        const barHeight = (d.revenue / max) * (height - 8);
        return (
          <g key={d.date}>
            <rect
              x={i * (barWidth + barGap)}
              y={height - barHeight}
              width={Math.max(barWidth, 1)}
              height={barHeight}
              rx={2}
              className="fill-accent"
              opacity={d.revenue > 0 ? 1 : 0.08}
            >
              <title>
                {d.date}: {formatNaira(d.revenue)} ({d.count} sale{d.count === 1 ? "" : "s"})
              </title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
};

const StatCard = ({ icon: Icon, label, value, sub }) => (
  <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
    <div className="w-10 h-10 rounded-2xl bg-accent-50 flex items-center justify-center mb-4">
      <Icon className="w-5 h-5 text-accent" />
    </div>
    <p className="text-xs font-medium text-gray-500">{label}</p>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
  </div>
);

const FunnelBar = ({ label, value, total, className }) => (
  <div>
    <div className="flex items-center justify-between text-sm mb-1">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
      <div
        className={`h-full rounded-full ${className}`}
        style={{ width: total > 0 ? `${Math.max(2, (value / total) * 100)}%` : "0%" }}
      />
    </div>
  </div>
);

const AdminAnalyticsPage = () => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.ADMIN.ANALYTICS);
        setData(res.data);
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load analytics"));
      } finally {
        setIsLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  // The backend only returns days that actually had revenue — filled in
  // here so the chart shows a continuous last-30-days axis, zeros included,
  // rather than compressing gaps together.
  const revenueSeries = useMemo(() => {
    if (!data) return [];
    const byDate = new Map(data.revenue.overTime.map((d) => [d.date, d]));
    const days = [];
    for (let i = DAYS_OF_HISTORY - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      days.push(byDate.get(key) || { date: key, revenue: 0, count: 0 });
    }
    return days;
  }, [data]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
          Couldn't load analytics. Please try again shortly.
        </div>
      </DashboardLayout>
    );
  }

  const { revenue, topBooks, topBundles, funnel, readers, referrals } = data;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-accent" />
            Analytics
          </h1>
          <p className="text-gray-500 mt-1">Business metrics, computed straight from the database.</p>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Wallet} label="Total Revenue" value={formatNaira(revenue.total)} />
          <StatCard icon={Users} label="Total Readers" value={readers.total} sub={`${readers.converted} converted`} />
          <StatCard
            icon={TrendingUp}
            label="Conversion Rate"
            value={`${readers.conversionRatePercent}%`}
            sub="readers with an approved purchase"
          />
          <StatCard
            icon={Gift}
            label="Referral Credit Outstanding"
            value={formatNaira(referrals.totalCreditOutstanding)}
            sub={`${formatNaira(referrals.totalCreditGranted)} granted total · ${referrals.totalConversions} conversions`}
          />
        </div>

        {/* Revenue over time */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Revenue — last 30 days</h2>
          {revenue.total === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No approved purchases yet.</p>
          ) : (
            <RevenueBarChart series={revenueSeries} />
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Funnel */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Purchase Funnel</h2>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <BookOpen className="w-4 h-4" />
              {funnel.totalPublishedBooks} published book{funnel.totalPublishedBooks === 1 ? "" : "s"} ·{" "}
              {funnel.totalPurchaseRequests} total request{funnel.totalPurchaseRequests === 1 ? "" : "s"}
            </div>
            <FunnelBar
              label="Approved"
              value={funnel.approved}
              total={funnel.totalPurchaseRequests}
              className="bg-emerald-500"
            />
            <FunnelBar
              label="Pending"
              value={funnel.pending}
              total={funnel.totalPurchaseRequests}
              className="bg-amber-400"
            />
            <FunnelBar
              label="Rejected"
              value={funnel.rejected}
              total={funnel.totalPurchaseRequests}
              className="bg-red-400"
            />
            <FunnelBar
              label="Revoked"
              value={funnel.revoked}
              total={funnel.totalPurchaseRequests}
              className="bg-slate-400"
            />
          </div>

          {/* Top books by revenue */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Top Books by Revenue</h2>
            {topBooks.byRevenue.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No approved book purchases yet.</p>
            ) : (
              <div className="space-y-1">
                {topBooks.byRevenue.map((book, i) => (
                  <div
                    key={book.bookId}
                    className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-5 text-xs font-semibold text-gray-400 flex-shrink-0">{i + 1}</span>
                      <span className="text-sm text-gray-800 truncate">{book.title}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                      <span className="text-gray-400">{book.purchaseCount}×</span>
                      <span className="font-semibold text-gray-900">{formatNaira(book.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bundle revenue — kept entirely separate from the per-book
            rankings above rather than attributed down to constituent
            books (there's no principled way to split a bundle's price
            across its books). */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-400" />
            Top Bundles by Revenue
          </h2>
          {topBundles.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No approved bundle purchases yet.</p>
          ) : (
            <div className="space-y-1">
              {topBundles.map((bundle, i) => (
                <div
                  key={bundle.bundleId}
                  className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-5 text-xs font-semibold text-gray-400 flex-shrink-0">{i + 1}</span>
                    <span className="text-sm text-gray-800 truncate">Bundle: {bundle.title}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                    <span className="text-gray-400">{bundle.purchaseCount}×</span>
                    <span className="font-semibold text-gray-900">{formatNaira(bundle.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top books by purchase count */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <h2 className="font-semibold text-gray-900 p-6 pb-3">Top Books by Purchase Count</h2>
          {topBooks.byPurchaseCount.length === 0 ? (
            <p className="text-sm text-gray-400 pb-6 text-center">No approved book purchases yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="px-6 py-3 font-medium">Book</th>
                    <th className="px-6 py-3 font-medium">Purchases</th>
                    <th className="px-6 py-3 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topBooks.byPurchaseCount.map((book) => (
                    <tr key={book.bookId} className="border-b border-gray-50 last:border-0">
                      <td className="px-6 py-3.5 font-medium text-gray-900">{book.title}</td>
                      <td className="px-6 py-3.5 text-gray-600">{book.purchaseCount}</td>
                      <td className="px-6 py-3.5 text-gray-600">{formatNaira(book.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminAnalyticsPage;
