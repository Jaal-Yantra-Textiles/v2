/**
 * Skeleton for the async ProductionStory server component. Mirrors the
 * section's shape (heading + a couple of run cards + a metric row) so the
 * layout doesn't jump while the story streams in. Medusa tokens only.
 */
export default function ProductionStorySkeleton() {
  return (
    <section
      className="flex flex-col gap-y-6 border-t border-ui-border-base pt-8"
      data-testid="production-story-skeleton"
    >
      <div className="flex flex-col gap-y-2">
        <div className="h-3 w-24 animate-pulse rounded-md bg-ui-bg-component-pressed" />
        <div className="h-6 w-48 animate-pulse rounded-md bg-ui-bg-component-pressed" />
      </div>

      <div className="flex flex-col gap-y-4">
        <div className="h-3 w-28 animate-pulse rounded-md bg-ui-bg-component-pressed" />
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4"
          >
            <div className="flex gap-2">
              <div className="h-5 w-20 animate-pulse rounded-md bg-ui-bg-component-pressed" />
              <div className="h-5 w-16 animate-pulse rounded-md bg-ui-bg-component-pressed" />
            </div>
            <div className="mt-3 h-3 w-3/4 animate-pulse rounded-md bg-ui-bg-component-pressed" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded-md bg-ui-bg-component-pressed" />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="h-6 w-28 animate-pulse rounded-md bg-ui-bg-component-pressed" />
        <div className="h-6 w-24 animate-pulse rounded-md bg-ui-bg-component-pressed" />
      </div>
    </section>
  )
}
