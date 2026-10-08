function Block({ className }: { className: string }) {
  return <div className={`rounded-md bg-white/[0.05] ${className}`} />;
}

/** Page-shaped placeholder: title, meta, people, items list. */
export function BillSkeleton() {
  return (
    <div className="animate-pulse space-y-10" aria-busy="true" aria-label="Loading bill">
      <div className="space-y-3">
        <Block className="h-9 w-56" />
        <Block className="h-4 w-72 max-w-full" />
        <div className="flex gap-2 pt-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="size-9 rounded-full bg-white/[0.05]" />
          ))}
        </div>
      </div>
      <div className="space-y-4 border-t border-white/10 pt-8">
        <Block className="h-4 w-24" />
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-8 shrink-0 rounded-full bg-white/[0.05]" />
            <Block className="h-4 w-32" />
          </div>
        ))}
      </div>
      <div className="space-y-4 border-t border-white/10 pt-8">
        <Block className="h-4 w-20" />
        <div className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex min-h-16 items-center gap-3 px-4">
              <Block className="h-4 flex-1" />
              <Block className="h-4 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
