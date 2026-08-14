const ViewBookSkeleton = () => (
  <div className="max-w-3xl mx-auto px-6 py-16 animate-pulse">
    <div className="h-8 bg-gray-200 rounded-xl w-2/3 mb-4"></div>
    <div className="h-4 bg-gray-100 rounded-lg w-1/3 mb-12"></div>

    <div className="space-y-4">
      <div className="h-4 bg-gray-100 rounded-lg w-full"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-11/12"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-4/5"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-full"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-3/4"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-5/6"></div>
    </div>
  </div>
);

export default ViewBookSkeleton;
