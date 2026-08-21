const PriceBadge = ({ badge }) => {
  if (!badge) return null;

  const isPrice = badge.type === "price";

  return (
    <span
      className={`absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm backdrop-blur-sm ${
        isPrice
          ? "bg-accent text-white"
          : "bg-white/90 text-gray-500"
      }`}
    >
      {badge.label}
    </span>
  );
};

export default PriceBadge;
