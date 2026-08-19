import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, CheckCircle2, XCircle, BookOpen } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import { formatNaira } from "../utils/kenlibsPricing";

const STATUS_META = {
  pending: { label: "Pending", icon: Clock, className: "bg-amber-50 text-amber-700" },
  approved: { label: "Approved", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", icon: XCircle, className: "bg-red-50 text-red-600" },
};

const KenlibsMyBooksPage = () => {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.PURCHASES.MINE);
        setRequests(res.data);
      } catch {
        setRequests([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRequests();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <KenlibsNav />

      <div className="max-w-3xl mx-auto px-6 lg:px-8 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">My Books</h1>
        <p className="text-gray-500 mb-8">Your purchase requests and their status.</p>

        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-white border border-gray-100 rounded-2xl" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center">
            <div className="w-16 h-16 bg-accent-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No requests yet</h3>
            <p className="text-gray-500 mb-6">
              Browse Kenlibs and request to buy a book or bundle to see it here.
            </p>
            <Link
              to="/kenlibs"
              className="inline-flex px-6 py-2.5 rounded-2xl text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary"
            >
              Browse Kenlibs
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => {
              const meta = STATUS_META[req.status] || STATUS_META.pending;
              const StatusIcon = meta.icon;
              return (
                <div
                  key={req._id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4"
                >
                  <div className="w-12 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                    {req.itemCoverImage && (
                      <img
                        src={req.itemCoverImage}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-gray-900 truncate">{req.itemTitle}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatNaira(req.amount)} · {req.itemType === "bundle" ? "Bundle" : "Book"}
                    </p>
                    {req.status === "rejected" && req.adminNote && (
                      <p className="text-xs text-red-500 mt-1">{req.adminNote}</p>
                    )}
                  </div>

                  <span
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ${meta.className}`}
                  >
                    <StatusIcon className="w-3.5 h-3.5" />
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default KenlibsMyBooksPage;
