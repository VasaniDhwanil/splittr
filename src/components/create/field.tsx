import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/** Shared input look for the create flow, matching the profile page. */
export const FIELD_INPUT = 'border-white/10 bg-white/[0.03] text-white placeholder:text-white/30';
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
