import type { ReactNode } from 'react';

/** The single surface each step sits on. */
export function StepSurface({ children }: { children: ReactNode }) {
  return <div className="surface space-y-6 rounded-2xl p-5 sm:p-6">{children}</div>;
}

interface StepActionsProps {
  onBack: () => void;
  children: ReactNode;
}

/** Ghost "Back" beside the step's primary action. */
export function StepActions({ onBack, children }: StepActionsProps) {
  return (
    <div className="flex items-center gap-2 border-t border-white/10 pt-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-white/60 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Back
      </button>
      <div className="flex-1">{children}</div>
    </div>
  );
}
