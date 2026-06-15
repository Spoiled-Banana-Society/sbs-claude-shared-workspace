// Route-level loading skeleton — mirrors the My Teams layout (header + filter
// chips + 2-up card grid) so a refresh never flashes a different-looking page.
export default function MyTeamsLoading() {
  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="h-8 w-44 bg-white/[0.06] rounded-lg animate-pulse mb-2" />
        <div className="h-4 w-36 bg-white/[0.04] rounded animate-pulse" />
      </div>

      {/* Filter chips + search row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 mb-5">
        <div className="flex gap-2 flex-shrink-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-20 bg-white/[0.05] rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-10 w-full bg-white/[0.04] rounded-lg animate-pulse" />
        </div>
      </div>

      {/* 2-up card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 sm:gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl overflow-hidden border border-white/[0.06] bg-white/[0.02]">
            <div className="aspect-[4/5] bg-white/[0.04] animate-pulse" />
            <div className="px-4 pt-3.5 pb-1 flex items-center justify-between">
              <div className="h-4 w-24 bg-white/[0.06] rounded animate-pulse" />
              <div className="h-3 w-20 bg-white/[0.04] rounded animate-pulse" />
            </div>
            <div className="px-4 pb-4 pt-2 flex gap-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex-1 h-8 bg-white/[0.05] rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
