import { useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import Button from "../ui/Button";
import { needsRightsConfirmation, publishMissing, rightsTypeLabel } from "../../utils/bookRights";

// The Publish / "Unpublish immediately" button on the editor's Details tab.
//   - Publishing a book that isn't "Own work" opens a confirmation: the
//     rights details must be complete and the admin must tick "I have the
//     rights or written permission to sell this book" (the server checks
//     the same, utils/bookRights.js).
//   - Unpublishing takes effect at once, with an optional private takedown
//     note; existing buyers keep reading.
const PublishControls = ({ book, onTogglePublish, isTogglingPublish }) => {
  const [dialog, setDialog] = useState(null); // 'publish' | 'unpublish' | null
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const isPublished = book.status === "published";
  const rights = book.rights || {};
  const missingDetails = publishMissing(rights, true);

  const close = () => {
    setDialog(null);
    setConfirmed(false);
    setNote("");
  };
  const publish = async () => {
    if (await onTogglePublish({ confirmRights: true })) close();
  };
  const unpublish = async () => {
    if (await onTogglePublish({ takedownNote: note.trim() || undefined })) close();
  };

  return (
    <>
      {isPublished ? (
        <Button onClick={() => setDialog("unpublish")} variant="secondary">
          Unpublish immediately
        </Button>
      ) : (
        <Button onClick={() => (needsRightsConfirmation(rights) ? setDialog("publish") : onTogglePublish())} loading={isTogglingPublish}>
          Publish Book
        </Button>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-labelledby="publish-dialog-title">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 id="publish-dialog-title" className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-accent" />
                {dialog === "publish" ? "Confirm the rights before publishing" : "Unpublish this book now?"}
              </h2>
              <button type="button" onClick={close} className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {dialog === "publish" ? (
              <>
                <p className="text-sm text-gray-600 mt-2">
                  "{book.title}" is marked <strong>{rightsTypeLabel(rights.type)}</strong>
                  {rights.holderName ? ` (rights holder: ${rights.holderName})` : ""}.
                </p>
                {missingDetails.length > 0 ? (
                  <div role="alert" className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                    <p className="font-semibold">Fill these in under Rights &amp; royalties first:</p>
                    <ul className="list-disc pl-5 mt-1">
                      {missingDetails.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <label className="mt-4 flex items-start gap-3 rounded-2xl border border-gray-200 px-4 py-3 cursor-pointer">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 w-4 h-4 accent-[var(--color-accent)]" />
                    <span className="text-sm text-gray-800">I have the rights or written permission to sell this book.</span>
                  </label>
                )}
                <div className="mt-6 flex justify-end gap-2">
                  <Button variant="secondary" onClick={close}>
                    Cancel
                  </Button>
                  <Button onClick={publish} loading={isTogglingPublish} disabled={isTogglingPublish || !confirmed || missingDetails.length > 0}>
                    Publish
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mt-2">
                  The store page, the public preview and the share link stop working at once. Readers who already bought it keep their access.
                </p>
                <label className="block mt-4">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Takedown note (optional, admins only)</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm" placeholder="e.g. Author withdrew permission on 19 Oct" />
                </label>
                <div className="mt-6 flex justify-end gap-2">
                  <Button variant="secondary" onClick={close}>
                    Cancel
                  </Button>
                  <Button onClick={unpublish} loading={isTogglingPublish}>
                    Unpublish now
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default PublishControls;
