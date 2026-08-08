export function LoadingSpinner({ size = 'md', className = '' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className={`${sizes[size]} ${className}`}>
      {/* Decorative: the surrounding component carries the announcement. */}
      <svg className="animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );
}

/**
 * Full-page loading state.
 *
 * This replaces the entire page on most routes while data arrives, and said nothing to assistive
 * technology — the previous screen simply vanished and was replaced silently. The live region
 * means the wait is announced, and then the arriving content is too.
 *
 * The CSS `animate-spin` is covered by the reduced-motion rule in index.css, which caps
 * animation-duration globally; no JS guard is needed here.
 */
export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size="lg" className="text-navy-700 dark:text-navy-300" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    </div>
  );
}

export function SkeletonCard() {
  return (
    // Uses the shared .skeleton class rather than its own greys, which had no dark variant and
    // rendered as a bright white card on the dark surface — brighter than the content it stood in
    // for. Same fix already applied to the table skeletons.
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="skeleton mb-3 h-4 w-1/2" />
      <div className="skeleton mb-2 h-8 w-1/3" />
      <div className="skeleton h-3 w-2/3" />
    </div>
  );
}
