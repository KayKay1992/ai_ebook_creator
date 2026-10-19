import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, FlaskConical, HandCoins, Loader2, Trash2 } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import { formatNaira } from "../utils/kenlibsPricing";
import { rightsTypeLabel, royaltiesCsv } from "../utils/bookRights";

// Royalties owed to the authors of books sold on Kenlibs
// (backend/controller/royaltyController.js). Cash revenue is the same
// definition as Analytics: price minus store credit used, counted on the
// approval day (Lagos); a bundle's cash is shared between its books by list
// price. "Mark as paid" only records a payment made elsewhere; nothing is
// paid out from here.

const lagosToday = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
const shiftDay = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
};
const formatDay = (day) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const inputClass = "bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 text-sm";
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap";
const td = "px-3 py-2.5 text-sm text-gray-800 whitespace-nowrap tabular-nums";

const AdminRoyaltiesPage = () => {
  const [from, setFrom] = useState(() => shiftDay(lagosToday(), -29));
  const [to, setTo] = useState(lagosToday);
  const [hideTest, setHideTest] = useState(true);
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [payment, setPayment] = useState({ authorName: "", amount: "", paidAt: lagosToday(), note: "" });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(
    () =>
      axiosInstance
        .get(API_PATHS.ADMIN.ROYALTIES, { params: { from, to, ...(hideTest ? { hideTest: "1" } : {}) } })
        .then((res) => setData(res.data))
        .catch((error) => toast.error(getErrorMessage(error, "Couldn't load royalties.")))
        .finally(() => setIsLoading(false)),
    [from, to, hideTest]
  );

  useEffect(() => {
    load();
  }, [load]);

  const authorNames = useMemo(() => (data?.authors || []).map((a) => a.author).filter((a) => a !== "(no author)"), [data]);

  const downloadCsv = () => {
    // Leading byte-order mark so Excel opens the UTF-8 (₦, accents) correctly.
    const blob = new Blob([String.fromCharCode(0xfeff) + royaltiesCsv(data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kenlibs-royalties-${data.range.from}-to-${data.range.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const recordPayment = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axiosInstance.post(API_PATHS.ADMIN.ROYALTY_PAYMENTS, { ...payment, amount: Number(payment.amount) });
      toast.success("Payment recorded.");
      setPayment((p) => ({ ...p, amount: "", note: "" }));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't record the payment."));
    } finally {
      setSaving(false);
    }
  };

  const removePayment = async (id) => {
    setBusyId(id);
    try {
      await axiosInstance.delete(API_PATHS.ADMIN.ROYALTY_PAYMENT(id));
      toast.success("Payment record removed.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't remove it."));
    } finally {
      setBusyId(null);
    }
  };

  const change = (fn) => (e) => {
    if (!e.target.value) return;
    setIsLoading(true);
    fn(e.target.value);
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <HandCoins className="w-6 h-6 text-accent" />
              Royalties
            </h1>
            <p className="text-sm text-gray-600 mt-1 max-w-2xl">
              Royalty = the book's royalty % × cash revenue (price minus store credit, on the approval day, Lagos time). Bundle sales are shared
              between their books by list price. Recording a payment here doesn't send any money.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={downloadCsv} disabled={!data}>
            <Download className="w-4 h-4 mr-2" />
            Download CSV
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            From
            <input type="date" value={from} max={to} onChange={change(setFrom)} className={inputClass} />
          </label>
          <label className="flex items-center gap-2">
            To
            <input type="date" value={to} min={from} max={lagosToday()} onChange={change(setTo)} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hideTest}
              onChange={(e) => {
                setIsLoading(true);
                setHideTest(e.target.checked);
              }}
              className="w-4 h-4"
            />
            <FlaskConical className="w-4 h-4 text-gray-400" />
            Hide test data
          </label>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" aria-label="Loading" />}
        </div>

        {data && (
          <>
            <p className="text-sm text-gray-600">
              {formatDay(data.range.from)} – {formatDay(data.range.to)}: {data.totals.units} unit{data.totals.units === 1 ? "" : "s"},{" "}
              {formatNaira(data.totals.cash)} cash, <strong>{formatNaira(data.totals.royaltyOwed)} royalties owed</strong>
              {data.testData.hidden ? " (test data hidden)" : ""}.
            </p>

            <section aria-labelledby="authors-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm">
              <h2 id="authors-heading" className="px-5 pt-5 pb-3 font-bold text-gray-900">
                By author
              </h2>
              {data.authors.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={th}>Author</th>
                        <th className={th}>Units</th>
                        <th className={th}>Cash</th>
                        <th className={th}>Owed (period)</th>
                        <th className={th}>Paid (period)</th>
                        <th className={th}>Owed all time</th>
                        <th className={th}>Paid all time</th>
                        <th className={th}>Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.authors.map((a) => (
                        <tr key={a.authorKey}>
                          <td className={`${td} font-medium`}>
                            {a.author} <span className="text-gray-500 font-normal">({a.books} book{a.books === 1 ? "" : "s"})</span>
                          </td>
                          <td className={td}>{a.units}</td>
                          <td className={td}>{formatNaira(a.cash)}</td>
                          <td className={td}>{formatNaira(a.royaltyOwed)}</td>
                          <td className={td}>{formatNaira(a.paidInRange)}</td>
                          <td className={td}>{formatNaira(a.allTimeOwed)}</td>
                          <td className={td}>{formatNaira(a.paidAllTime)}</td>
                          <td className={`${td} font-semibold ${a.balance > 0 ? "text-amber-800" : ""}`}>{formatNaira(a.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-5 pb-5 text-sm text-gray-500">No books with a royalty or sales yet.</p>
              )}
            </section>

            <section aria-labelledby="books-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm">
              <h2 id="books-heading" className="px-5 pt-5 pb-3 font-bold text-gray-900">
                By book
              </h2>
              {data.books.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={th}>Book</th>
                        <th className={th}>Author</th>
                        <th className={th}>Rights</th>
                        <th className={th}>Units</th>
                        <th className={th}>Cash</th>
                        <th className={th}>Royalty %</th>
                        <th className={th}>Owed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.books.map((b) => (
                        <tr key={b.bookId}>
                          <td className={`${td} font-medium`}>
                            <Link to={`/editor/${b.bookId}`} className="hover:text-accent">
                              {b.title}
                            </Link>
                            {b.status !== "published" && <span className="ml-2 text-xs text-gray-500">({b.status})</span>}
                          </td>
                          <td className={td}>{b.author}</td>
                          <td className={td}>{rightsTypeLabel(b.rightsType)}</td>
                          <td className={td} title={`${b.directUnits} direct, ${b.bundleUnits} in bundles`}>
                            {b.units}
                          </td>
                          <td className={td}>{formatNaira(b.cash)}</td>
                          <td className={td}>{b.royaltyPercent}%</td>
                          <td className={`${td} font-semibold`}>{formatNaira(b.royaltyOwed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-5 pb-5 text-sm text-gray-500">No sales in this period.</p>
              )}
            </section>

            <section aria-labelledby="payments-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
              <h2 id="payments-heading" className="font-bold text-gray-900 mb-1">
                Mark as paid
              </h2>
              <p className="text-sm text-gray-600 mb-4">Record a royalty payment you made outside Kenlibs (bank transfer etc.).</p>
              <form onSubmit={recordPayment} className="grid gap-3 sm:grid-cols-4 items-end">
                <label className="block text-sm">
                  <span className="block font-medium text-gray-700 mb-1">Author</span>
                  <select required value={payment.authorName} onChange={(e) => setPayment((p) => ({ ...p, authorName: e.target.value }))} className={`${inputClass} w-full py-2`}>
                    <option value="">Choose…</option>
                    {authorNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="block font-medium text-gray-700 mb-1">Amount (₦)</span>
                  <input required type="number" min="0.01" step="0.01" value={payment.amount} onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} className={`${inputClass} w-full py-2`} />
                </label>
                <label className="block text-sm">
                  <span className="block font-medium text-gray-700 mb-1">Paid on</span>
                  <input required type="date" value={payment.paidAt} max={lagosToday()} onChange={(e) => setPayment((p) => ({ ...p, paidAt: e.target.value }))} className={`${inputClass} w-full py-2`} />
                </label>
                <label className="block text-sm sm:col-span-4">
                  <span className="block font-medium text-gray-700 mb-1">Note (optional)</span>
                  <input value={payment.note} maxLength={1000} onChange={(e) => setPayment((p) => ({ ...p, note: e.target.value }))} className={`${inputClass} w-full py-2`} placeholder="e.g. Transfer ref 1234" />
                </label>
                <div>
                  <Button size="sm" type="submit" loading={saving}>
                    Record payment
                  </Button>
                </div>
              </form>

              {data.payments.length > 0 && (
                <ul className="mt-6 divide-y divide-gray-100 border-t border-gray-100">
                  {data.payments.map((p) => (
                    <li key={p.id} className="py-3 flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">
                          {formatNaira(p.amount)} to {p.authorName}
                        </p>
                        <p className="text-gray-500 break-words">
                          {new Date(p.paidAt).toLocaleDateString("en-NG", { dateStyle: "medium" })}
                          {p.note ? ` · ${p.note}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePayment(p.id)}
                        disabled={busyId === p.id}
                        className="w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        aria-label={`Remove the ${formatNaira(p.amount)} payment to ${p.authorName}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminRoyaltiesPage;
