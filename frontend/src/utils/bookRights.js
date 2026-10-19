// Rights labels, the publish-confirmation rules and the royalties CSV
// (admin). Pure (npm test). The publish rules mirror the backend's
// utils/bookRights.js publishGuard, which is the one that's enforced.

export const RIGHTS_TYPES = [
  { value: "own", label: "Own work" },
  { value: "licensed", label: "Licensed from the author or publisher" },
  { value: "public_domain", label: "Public domain" },
];

export const rightsTypeLabel = (type) => RIGHTS_TYPES.find((t) => t.value === (type || "own"))?.label || "Own work";

// What still stops this book being published. `confirmed` = the tick box.
export const publishMissing = (rights = {}, confirmed = false) => {
  const type = rights.type || "own";
  if (type === "own") return [];
  const missing = [];
  if (type === "licensed") {
    if (!String(rights.holderName || "").trim()) missing.push("Rights holder name");
    if (!String(rights.licenceNotes || "").trim()) missing.push("Licence notes");
  } else if (!String(rights.licenceNotes || "").trim()) missing.push("A note on why the book is public domain");
  if (!confirmed) missing.push("Confirmation that you have the rights or written permission to sell this book");
  return missing;
};

export const needsRightsConfirmation = (rights = {}) => (rights.type || "own") !== "own";

// "expired" | "expiring" (within 30 days) | null
export const licenceState = (rights = {}, now = Date.now()) => {
  if (!rights.licenceExpiresAt || (rights.type || "own") === "own") return null;
  const t = new Date(rights.licenceExpiresAt).getTime();
  if (Number.isNaN(t)) return null;
  if (t <= now) return "expired";
  return t - now <= 30 * 86400000 ? "expiring" : null;
};

// CSV cell: quoted, with formula injection neutralised (a value starting
// with = + - @ or a tab is prefixed with ' so spreadsheets show it as text).
export const csvCell = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export const toCsv = (rows) => rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

// The royalties report as CSV: per-book rows, then per-author rows.
export const royaltiesCsv = (report) => {
  const rows = [
    [`Kenlibs royalties ${report.range?.from || ""} to ${report.range?.to || ""}`, report.testData?.hidden ? "test data hidden" : ""],
    [],
    ["Book", "Author", "Rights", "Units", "Cash revenue (NGN)", "Royalty %", "Royalty owed (NGN)"],
    ...(report.books || []).map((b) => [b.title, b.author, rightsTypeLabel(b.rightsType), b.units, b.cash, b.royaltyPercent, b.royaltyOwed]),
    [],
    ["Author", "Books", "Units", "Cash revenue (NGN)", "Royalty owed in period (NGN)", "Paid in period (NGN)", "Owed all time (NGN)", "Paid all time (NGN)", "Balance (NGN)"],
    ...(report.authors || []).map((a) => [a.author, a.books, a.units, a.cash, a.royaltyOwed, a.paidInRange, a.allTimeOwed, a.paidAllTime, a.balance]),
  ];
  return toCsv(rows);
};
