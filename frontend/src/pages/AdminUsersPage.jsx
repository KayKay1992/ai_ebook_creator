import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Users, Loader2 } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

// Internal admin tool — same plain/functional discipline as
// AdminBundlesPage.jsx and AdminPurchasesPage.jsx.
const AdminUsersPage = () => {
  const [readers, setReaders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchReaders = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.ADMIN.USERS);
        setReaders(res.data);
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load users"));
      } finally {
        setIsLoading(false);
      }
    };
    fetchReaders();
  }, []);

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
            <Users className="w-6 h-6 text-accent" />
            Readers
          </h1>
          <p className="text-gray-500 mt-1">
            Every account registered through Kenlibs, and their purchase activity.
          </p>
        </div>

        {readers.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
            No readers have signed up yet.
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Signed up</th>
                    <th className="px-6 py-3 font-medium">Pending</th>
                    <th className="px-6 py-3 font-medium">Approved</th>
                    <th className="px-6 py-3 font-medium">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {readers.map((reader) => (
                    <tr key={reader._id} className="border-b border-gray-50 last:border-0">
                      <td className="px-6 py-3.5 font-medium text-gray-900">{reader.name}</td>
                      <td className="px-6 py-3.5 text-gray-600">{reader.email}</td>
                      <td className="px-6 py-3.5 text-gray-500">{formatDate(reader.createdAt)}</td>
                      <td className="px-6 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                          {reader.purchaseSummary.pending}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                          {reader.purchaseSummary.approved}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">
                          {reader.purchaseSummary.rejected}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminUsersPage;
