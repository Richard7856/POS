/**
 * Skeleton UI primitives — animated placeholder blocks shown while data loads.
 * Replaces blank screens with structure that matches the real layout,
 * so the page feels instant even before data arrives.
 */

// Single animated shimmer block
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} />
  )
}

// ── Composed skeletons per page ───────────────────────────────────────────────

/** Dashboard: 3 KPI sections × 3 cards + payment breakdown + merma + top table */
export function DashboardSkeleton() {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="h-3 w-52" />
        </div>
        <SkeletonBlock className="h-5 w-20" />
      </div>

      {/* 3 KPI sections */}
      {[0, 1, 2].map((i) => (
        <section key={i} className="space-y-2">
          <SkeletonBlock className="h-4 w-24" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((j) => (
              <div key={j} className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm space-y-2">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-7 w-28" />
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
          <SkeletonBlock className="h-4 w-40" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex justify-between">
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-10 w-24" />
          <SkeletonBlock className="h-2 w-full rounded-full" />
        </div>
      </div>

      {/* Top productos table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <SkeletonBlock className="h-4 w-52" />
        </div>
        <div className="divide-y divide-gray-100">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-4">
                <SkeletonBlock className="h-4 w-4" />
                <SkeletonBlock className="h-4 w-32" />
              </div>
              <div className="flex gap-8">
                <SkeletonBlock className="h-4 w-16" />
                <SkeletonBlock className="h-4 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** POS: category tabs + product grid */
export function POSSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Category tabs */}
      <div className="flex gap-2 px-4 pt-4 pb-2 overflow-x-auto">
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonBlock key={i} className="h-8 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      {/* Search bar */}
      <div className="px-4 pb-3">
        <SkeletonBlock className="h-10 w-full rounded-xl" />
      </div>
      {/* Product grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm space-y-2">
              <SkeletonBlock className="h-4 w-3/4" />
              <SkeletonBlock className="h-3 w-1/2" />
              <SkeletonBlock className="h-6 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Historial: date picker + list of sale rows */
export function HistorialSkeleton() {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      {/* Header + date */}
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-6 w-32" />
        <SkeletonBlock className="h-9 w-36 rounded-lg" />
      </div>
      {/* Sale rows */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm flex items-center justify-between">
            <div className="space-y-1.5">
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="h-3 w-36" />
            </div>
            <SkeletonBlock className="h-6 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Corte de caja: totals breakdown + input */
export function CorteSkeleton() {
  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-6 w-40" />
        <SkeletonBlock className="h-9 w-36 rounded-lg" />
      </div>
      {/* Totals card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <SkeletonBlock className="h-4 w-32" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex justify-between">
            <SkeletonBlock className="h-4 w-40" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
        ))}
        <div className="border-t border-gray-100 pt-3 flex justify-between">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBlock className="h-5 w-28" />
        </div>
      </div>
      {/* Input */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="h-12 w-full rounded-lg" />
        <SkeletonBlock className="h-10 w-full rounded-lg" />
      </div>
    </div>
  )
}
