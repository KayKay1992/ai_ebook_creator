const KenlibsCardSkeleton = () => (
  <div className="w-40 sm:w-48 flex-shrink-0 animate-pulse">
    <div className="aspect-[2/3] w-full rounded-2xl bg-gray-100" />
    <div className="h-4 bg-gray-100 rounded-lg w-3/4 mt-3" />
    <div className="h-3 bg-gray-100 rounded-lg w-1/2 mt-2" />
  </div>
);

export default KenlibsCardSkeleton;
