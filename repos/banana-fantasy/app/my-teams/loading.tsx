export default function StandingsLoading() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 sm:px-8 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="h-8 w-44 bg-white/5 rounded-lg animate-pulse mb-6" />
        {/* League tabs */}
        <div className="flex gap-3 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 w-32 bg-white/10 rounded-lg animate-pulse" />
          ))}
        </div>
        {/* Table skeleton */}
        <div className="bg-white/5 rounded-xl overflow-hidden">
          {/* Header row */}
          <div className="flex gap-4 p-4 border-b border-white/10">
            <div className="h-4 w-8 bg-white/10 rounded animate-pulse" />
            <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
            <div className="h-4 w-16 bg-white/10 rounded animate-pulse ml-auto" />
            <div className="h-4 w-16 bg-white/10 rounded animate-pulse" />
            <div className="h-4 w-16 bg-white/10 rounded animate-pulse" />
          </div>
          {/* Data rows */}
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex gap-4 p-4 border-b border-white/5">
              <div className="h-4 w-8 bg-white/5 rounded animate-pulse" />
              <div className="h-4 w-40 bg-white/5 rounded animate-pulse" />
              <div className="h-4 w-16 bg-white/5 rounded animate-pulse ml-auto" />
              <div className="h-4 w-16 bg-white/5 rounded animate-pulse" />
              <div className="h-4 w-16 bg-white/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
