import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/** Lit field: a touch brighter than surfaces, same top highlight, green focus. No text color. */
export const LIT_FIELD =
  'border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] focus-visible:border-primary/50 focus-visible:ring-primary/40';

/** Shared input look for the create flow, profile, sign-in and the groups dialogs. */
export const FIELD_INPUT = `${LIT_FIELD} text-white placeholder:text-white/30`;
export const FIELD_LABEL = 'text-sm font-medium text-white/70';

interface FieldProps {
  /** Id of the control the label points at. Omit for groups of buttons. */
  htmlFor?: string;
  label: string;
  helper?: ReactNode;
  error?: string;
  children: ReactNode;
}

/** Label above, control, then a muted helper or an inline error. */
export function Field({ htmlFor, label, helper, error, children }: FieldProps) {
  return (
    <div className="space-y-2">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className={FIELD_LABEL}>
          {label}
        </Label>
      ) : (
        <p className={FIELD_LABEL}>{label}</p>
      )}
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        helper && <p className="text-xs text-white/35">{helper}</p>
      )}
    </div>
  );
}
