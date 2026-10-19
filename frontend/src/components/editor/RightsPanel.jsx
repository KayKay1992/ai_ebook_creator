import { useState } from "react";
import { AlertTriangle, Scale, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import getErrorMessage from "../../utils/getErrorMessage";
import Button from "../ui/Button";
import { RIGHTS_TYPES, licenceState } from "../../utils/bookRights";

// Rights, attribution and royalties for a book (admin-only data, saved via
// PUT /api/books/:id/rights; never part of the book's autosave and never
// shown to readers). The author shown on the storefront is the book's
// Author field above.

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
const formatDate = (value) => (value ? new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "");

const fieldClass = "w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent";

const RightsPanel = ({ book, onRightsSaved }) => {
  const saved = book.rights || {};
  const [form, setForm] = useState(() => ({
    type: saved.type || "own",
    holderName: saved.holderName || "",
    holderContact: saved.holderContact || "",
    licenceNotes: saved.licenceNotes || "",
    licenceReference: saved.licenceReference || "",
    licenceExpiresAt: toDateInput(saved.licenceExpiresAt),
    territory: saved.territory || "",
    royaltyPercent: saved.royaltyPercent ?? 0,
  }));
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const own = form.type === "own";
  const expiry = licenceState({ ...form, licenceExpiresAt: form.licenceExpiresAt || null });

  const save = async () => {
    setSaving(true);
    try {
      const res = await axiosInstance.put(API_PATHS.BOOKS.RIGHTS(book._id), {
        ...form,
        licenceExpiresAt: form.licenceExpiresAt || null,
        royaltyPercent: form.royaltyPercent === "" ? 0 : Number(form.royaltyPercent),
      });
      onRightsSaved(res.data.rights);
      toast.success("Rights details saved.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't save the rights details."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="rights-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
      <h3 id="rights-heading" className="text-xl font-bold text-gray-900 mb-1 flex items-center gap-2">
        <Scale className="w-5 h-5 text-gray-400" />
        Rights &amp; royalties
      </h3>
      <p className="text-gray-600 mb-5 text-sm">
        Private to admins. Readers only ever see the author's name ("by {book.author || "…"}").
      </p>

      {expiry && (
        <p role="alert" className={`mb-5 flex items-start gap-2 rounded-2xl px-4 py-3 text-sm border ${expiry === "expired" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {expiry === "expired"
            ? "The licence has expired. The book stays as it is until you unpublish it or renew the licence."
            : "The licence expires within 30 days."}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2 block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Rights</span>
          <select value={form.type} onChange={set("type")} className={fieldClass}>
            {RIGHTS_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {!own && (
          <>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Rights holder {form.type === "licensed" && <span className="text-red-600">*</span>}
              </span>
              <input value={form.holderName} onChange={set("holderName")} maxLength={200} className={fieldClass} placeholder="e.g. Ade Bello" />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Rights holder contact</span>
              <input value={form.holderContact} onChange={set("holderContact")} maxLength={300} className={fieldClass} placeholder="Email or phone" />
            </label>
            <label className="sm:col-span-2 block">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                {form.type === "public_domain" ? "Why it's public domain" : "Licence notes"} <span className="text-red-600">*</span>
              </span>
              <textarea
                value={form.licenceNotes}
                onChange={set("licenceNotes")}
                maxLength={4000}
                rows={3}
                className={fieldClass}
                placeholder={form.type === "public_domain" ? "e.g. Author died in 1930; out of copyright in Nigeria" : "e.g. Signed agreement of 3 Oct 2026: worldwide ebook rights, 15% royalty"}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Licence reference</span>
              <input value={form.licenceReference} onChange={set("licenceReference")} maxLength={200} className={fieldClass} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Licence expires</span>
              <input type="date" value={form.licenceExpiresAt} onChange={set("licenceExpiresAt")} className={fieldClass} />
            </label>
            <label className="sm:col-span-2 block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Territory notes</span>
              <input value={form.territory} onChange={set("territory")} maxLength={500} className={fieldClass} placeholder="e.g. Worldwide except UK" />
            </label>
          </>
        )}
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Royalty (% of cash revenue)</span>
          <input type="number" min="0" max="100" step="0.5" value={form.royaltyPercent} onChange={set("royaltyPercent")} className={fieldClass} />
        </label>
      </div>

      {saved.confirmedAt && !own && (
        <p className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          Rights confirmed when last published, {formatDate(saved.confirmedAt)}.
        </p>
      )}
      {saved.unpublishedAt && (
        <p className="mt-2 text-sm text-gray-600">
          Last unpublished {formatDate(saved.unpublishedAt)}
          {saved.takedownNote ? `: "${saved.takedownNote}"` : "."}
        </p>
      )}

      <div className="mt-6">
        <Button onClick={save} loading={saving}>
          Save rights details
        </Button>
      </div>
    </section>
  );
};

export default RightsPanel;
