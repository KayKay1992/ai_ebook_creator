const EditorSkeleton = () => (
  <div className="min-h-screen bg-gray-50 flex animate-pulse">
    {/* Sidebar */}
    <div className="hidden md:flex md:w-80 lg:w-96 flex-shrink-0 border-r border-gray-200 bg-white flex-col">
      <div className="p-5 border-b border-gray-100">
        <div className="h-4 bg-gray-100 rounded-lg w-2/5 mb-4"></div>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gray-100 flex-shrink-0"></div>
          <div className="flex-1 space-y-2 mt-1">
            <div className="h-4 bg-gray-100 rounded-lg w-3/4"></div>
            <div className="h-3 bg-gray-100 rounded-lg w-1/3"></div>
          </div>
        </div>
      </div>

      <div className="flex-1 px-3 py-4 space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-2xl">
            <div className="w-7 h-7 rounded-xl bg-gray-100 flex-shrink-0"></div>
            <div className="h-3.5 bg-gray-100 rounded-lg flex-1"></div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-gray-100">
        <div className="h-11 bg-gray-100 rounded-2xl w-full"></div>
      </div>
    </div>

    {/* Main Content */}
    <div className="flex-1 flex flex-col min-w-0">
      <header className="sticky top-0 z-30 bg-white/80 border-b border-gray-200">
        <div className="flex items-center justify-between px-4 lg:px-8 h-16">
          <div className="h-5 bg-gray-100 rounded-lg w-40 hidden sm:block"></div>
          <div className="h-10 bg-gray-100 rounded-2xl w-56"></div>
          <div className="flex items-center gap-3">
            <div className="h-10 bg-gray-100 rounded-2xl w-28 hidden sm:block"></div>
            <div className="h-10 bg-gray-100 rounded-2xl w-24"></div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 lg:px-8 py-8 space-y-6">
          <div className="h-11 bg-gray-100 rounded-2xl w-full"></div>
          <div className="h-72 bg-gray-100 rounded-2xl w-full"></div>
        </div>
      </main>
    </div>
  </div>
);

export default EditorSkeleton;
