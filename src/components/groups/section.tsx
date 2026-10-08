import type { ReactNode } from 'react';
import { Reveal } from './reveal';

interface SectionProps {
  title: string;
  description?: string;
  /** Muted figure set beside the title, e.g. a member count. */
  count?: number;
  /** Right-aligned slot in the heading row, e.g. a ghost button. */
  action?: ReactNode;
  index?: number;
  children: ReactNode;
}

export function Section({ title, description, count, action, index, children }: SectionProps) {
  return (
    <Reveal index={index} className="border-t border-white/10 pt-8">
      <section>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-white">
              {title}
              {count !== undefined && (
                <span className="ml-2 font-normal tabular-nums text-white/35"> {count}</span>
              )}
            </h2>
            {description && <p className="mt-1 text-sm text-white/40">{description}</p>}
          </div>
          {action && <div className="-mr-2 -mt-1.5 shrink-0">{action}</div>}
        </div>
        {children}
      </section>
    </Reveal>
  );
}
