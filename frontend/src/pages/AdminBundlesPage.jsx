import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Package, Plus, Trash2, Pencil, Loader2, X } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import InputField from "../components/ui/inputField";

const EMPTY_FORM = { title: "", description: "", price: "", isForSale: false, books: [] };

// Internal admin tool for Kenlibs bundle CRUD — deliberately plain/functional
// rather than polished, per KENLIBS-ARCHITECTURE.md's Step 24 scope. No
// public storefront rendering happens here; that's Step 25+.
const AdminBundlesPage = () => {
  const [bundles, setBundles] = useState([]);
  const [books, setBooks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [bundlesRes, booksRes] = await Promise.all([
          axiosInstance.get(API_PATHS.BUNDLES.BASE),
          axiosInstance.get(API_PATHS.BOOKS.GET_BOOKS),
        ]);
        setBundles(bundlesRes.data);
        setBooks(booksRes.data);
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load bundles"));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const handleEdit = (bundle) => {
    setEditingId(bundle._id);
    setForm({
      title: bundle.title,
      description: bundle.description || "",
      price: bundle.price?.toString() ?? "",
      isForSale: bundle.isForSale,
      books: (bundle.books || []).map((b) => (typeof b === "string" ? b : b._id)),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleBookInForm = (bookId) => {
    setForm((prev) => ({
      ...prev,
      books: prev.books.includes(bookId)
        ? prev.books.filter((id) => id !== bookId)
        : [...prev.books, bookId],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || form.price === "") {
      toast.error("Title and price are required.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description,
        price: Number(form.price),
        isForSale: form.isForSale,
        books: form.books,
      };

      if (editingId) {
        const res = await axiosInstance.put(`${API_PATHS.BUNDLES.BASE}/${editingId}`, payload);
        setBundles((prev) => prev.map((b) => (b._id === editingId ? res.data : b)));
        toast.success("Bundle updated!");
      } else {
        const res = await axiosInstance.post(API_PATHS.BUNDLES.BASE, payload);
        setBundles((prev) => [res.data, ...prev]);
        toast.success("Bundle created!");
      }
      resetForm();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to save bundle"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axiosInstance.delete(`${API_PATHS.BUNDLES.BASE}/${id}`);
      setBundles((prev) => prev.filter((b) => b._id !== id));
      toast.success("Bundle deleted.");
      if (editingId === id) resetForm();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete bundle"));
    }
  };

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
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-accent" />
            Bundles
          </h1>
          <p className="text-gray-500 mt-1">
            Group books into a priced bundle for the Kenlibs storefront.
          </p>
        </div>

        {/* ===== Create / Edit form ===== */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {editingId ? "Edit Bundle" : "New Bundle"}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <X className="w-3.5 h-3.5" />
                Cancel edit
              </button>
            )}
          </div>

          <InputField
            label="Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. The Complete Nigerian Finance Collection"
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Description (optional)
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="What ties these books together?"
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all resize-none"
            />
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <div className="w-40">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Price (NGN)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  ₦
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-8 pr-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 pb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isForSale}
                onChange={(e) => setForm((f) => ({ ...f, isForSale: e.target.checked }))}
                className="w-4 h-4 rounded accent-accent"
              />
              <span className="text-sm font-medium text-gray-700">List for sale</span>
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Books in this bundle ({form.books.length} selected)
            </label>
            {books.length === 0 ? (
              <p className="text-sm text-gray-400">
                You don't have any books yet — create one from the dashboard first.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-2xl divide-y divide-gray-100">
                {books.map((book) => (
                  <label
                    key={book._id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.books.includes(book._id)}
                      onChange={() => toggleBookInForm(book._id)}
                      className="w-4 h-4 rounded accent-accent flex-shrink-0"
                    />
                    <span className="text-sm text-gray-800 truncate">
                      {book.title || "Untitled Book"}
                    </span>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {book.author}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Button type="submit" loading={isSaving} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {editingId ? "Save Changes" : "Create Bundle"}
          </Button>
        </form>

        {/* ===== Existing bundles ===== */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">
            Existing Bundles ({bundles.length})
          </h2>

          {bundles.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center text-gray-400">
              No bundles yet — create one above.
            </div>
          ) : (
            bundles.map((bundle) => (
              <div
                key={bundle._id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{bundle.title}</h3>
                    <span className="text-sm text-gray-500">
                      ₦{Number(bundle.price).toFixed(2)}
                    </span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        bundle.isForSale
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {bundle.isForSale ? "For sale" : "Not listed"}
                    </span>
                  </div>
                  {bundle.description && (
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                      {bundle.description}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    {(bundle.books || []).length === 0
                      ? "No books yet"
                      : (bundle.books || []).map((b) => b.title || "Untitled").join(", ")}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleEdit(bundle)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
                    title="Edit bundle"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(bundle._id)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="Delete bundle"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminBundlesPage;
