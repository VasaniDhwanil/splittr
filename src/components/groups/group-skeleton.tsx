function Block({ className }: { className: string }) {
  return <div className={`rounded-md bg-white/[0.05] ${className}`} />;
}

/** Page-shaped placeholder: header, balances, list. */
export function GroupSkeleton() {
  return (
    <div className="animate-pulse space-y-10" aria-busy="true" aria-label="Loading group">
      <div className="space-y-3">
        <Block className="h-9 w-56" />
        <Block className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-4 border-t border-white/10 pt-8">
        <Block className="h-4 w-24" />
        <div className="surface space-y-px overflow-hidden rounded-2xl">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-4">
              <div className="size-8 shrink-0 rounded-full bg-white/[0.05]" />
              <Block className="h-4 flex-1" />
              <Block className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4 border-t border-white/10 pt-8">
        <Block className="h-4 w-20" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-8 shrink-0 rounded-full bg-white/[0.05]" />
            <Block className="h-4 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}
