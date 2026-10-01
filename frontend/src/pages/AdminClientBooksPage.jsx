import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Briefcase, Loader2, CheckCircle2, Clock } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import { formatNaira } from "../utils/kenlibsPricing";

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";

// Reuses GET /api/books (the same admin-owned-books list DashboardPage
// fetches) rather than a new endpoint — it already returns every field on
// each book to its owning admin, so filtering for isClientPublished is
// purely a client-side concern, same reasoning as the earlier legacy-cover
// audit and the storefront's client-side search/filter.
const AdminClientBooksPage = () => {
  const [books, setBooks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // 'all' | 'unpaid' | 'paid'
  const navigate = useNavigate();

  useEffect(() => {
    const fetchBooks = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.BOOKS.GET_BOOKS);
        setBooks(res.data.filter((b) => b.isClientPublished));
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load client books"));
      } finally {
        setIsLoading(false);
      }
    };
    fetchBooks();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "unpaid") return books.filter((b) => !b.publishingFee?.paid);
    if (filter === "paid") return books.filter((b) => b.publishingFee?.paid);
    return books;
  }, [books, filter]);

  const totals = useMemo(() => {
    const owed = books
      .filter((b) => !b.publishingFee?.paid)
      .reduce((sum, b) => sum + (b.publishingFee?.amount || 0), 0);
    const collected = books
      .filter((b) => b.publishingFee?.paid)
      .reduce((sum, b) => sum + (b.publishingFee?.amount || 0), 0);
    return { owed, collected };
  }, [books]);

  const FILTERS = [
    { key: "all", label: "All" },
    { key: "unpaid", label: "Unpaid" },
    { key: "paid", label: "Paid" },
  ];

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-accent" />
            Client Books
          </h1>
          <p className="text-gray-500 mt-1">
            Every book published on behalf of a client, and whether their fee's been paid.
          </p>
        </div>

        {books.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-amber-50 text-amber-700">
              {formatNaira(totals.owed)} owed
            </span>
            <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700">
              {formatNaira(totals.collected)} collected
            </span>
          </div>
        )}

        {books.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
            No client-published books yet — mark a book as client-published in its
            Details tab to see it tracked here.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-2xl w-fit">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    filter === f.key
                      ? "bg-white text-accent-hover shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filtered.map((book) => {
                const fee = book.publishingFee || {};
                return (
                  <div
                    key={book._id}
                    onClick={() => navigate(`/editor/${book._id}`)}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-serif font-semibold text-gray-900 truncate">
                        {book.title || "Untitled Book"}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        Client: {book.clientName || "—"}
                        {book.clientContact ? ` · ${book.clientContact}` : ""}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="font-semibold text-gray-900">
                        {fee.amount != null ? formatNaira(fee.amount) : "No fee set"}
                      </p>
                      {fee.paid ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 mt-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Paid {formatDate(fee.paidDate)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 mt-1">
                          <Clock className="w-3.5 h-3.5" />
                          Unpaid
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminClientBooksPage;
