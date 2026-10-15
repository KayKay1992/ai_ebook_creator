// Shared storefront badge logic — a single source of truth so the grid
// cards and detail pages can't drift on what counts as "for sale" vs
// "coming soon" (see KENLIBS-ARCHITECTURE.md's visibility rule: a published
// book with no price, or one that's priced but not yet listed, still shows
// up — it just isn't purchasable yet).
export const getBookBadge = ({ price, isForSale }) => {
  if (isForSale && typeof price === "number" && price > 0) {
    return { type: "price", label: formatNaira(price) };
  }
  if (isForSale && price === 0) {
    return null; // free — no badge, per the Kotobee reference pattern
  }
  return { type: "comingSoon", label: "Coming Soon" };
};

// The one Naira format for the whole app (the backend's emails use the
// same rule): thousands separators, and two decimals only when there are
// any. ₦5,000 · ₦1,500.50 · ₦9.99 · ₦0
export const formatNaira = (amount) => {
  const value = Number(amount) || 0;
  const digits = Math.round(value * 100) % 100 === 0 ? 0 : 2;
  return `₦${value.toLocaleString("en-NG", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
