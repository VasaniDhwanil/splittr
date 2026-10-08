import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

/** One quiet line with a small primary dot (or a check), in place of a warning card. */
export function Note({ children, check }: { children: ReactNode; check?: boolean }) {
  return (
    <p className="flex items-start gap-2.5 text-sm leading-relaxed text-white/60">
      {check ? (
        <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2.5} />
      ) : (
        <span className="mt-[0.5625rem] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
