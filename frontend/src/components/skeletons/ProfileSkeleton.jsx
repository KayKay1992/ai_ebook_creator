const ProfileSkeleton = () => (
  <div className="max-w-3xl mx-auto animate-pulse">
    {/* Header */}
    <div className="mb-8">
      <div className="h-3 bg-gray-100 rounded-lg w-20 mb-3"></div>
      <div className="h-8 bg-gray-200 rounded-xl w-40 mb-2"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-2/3"></div>
    </div>

    {/* Card */}
    <div className="relative rounded-3xl bg-white shadow-sm border border-gray-100 overflow-hidden">
      <div className="h-1.5 w-full bg-gray-100" />

      <div className="p-8 sm:p-10">
        {/* Avatar row */}
        <div className="flex items-center gap-4 mb-8 pb-8 border-b border-gray-100">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex-shrink-0"></div>
          <div className="space-y-2">
            <div className="h-4 bg-gray-100 rounded-lg w-32"></div>
            <div className="h-3 bg-gray-100 rounded-lg w-40"></div>
          </div>
        </div>

        {/* Form fields */}
        <div className="space-y-5 max-w-md">
          <div className="space-y-2">
            <div className="h-3 bg-gray-100 rounded-lg w-20"></div>
            <div className="h-11 bg-gray-100 rounded-xl w-full"></div>
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-100 rounded-lg w-16"></div>
            <div className="h-11 bg-gray-100 rounded-xl w-full"></div>
          </div>

          <div className="pt-2">
            <div className="h-10 bg-gray-100 rounded-xl w-40"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default ProfileSkeleton;
