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

export const formatNaira = (amount) =>
  `₦${Number(amount).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
