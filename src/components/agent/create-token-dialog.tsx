'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DIALOG_SURFACE } from '@/components/groups/group-dialog';
import { Field, FIELD_INPUT } from '@/components/create/field';
import { ChoicePill } from '@/components/create/choice-pill';
import { Segmented } from '@/components/create/segmented';
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  SCOPE_LABELS,
  formatClock,
  tokenErrorMessage,
  type AgentScope,
  type ExpiryDays,
} from '@/lib/agent-ui';
import { TokenReveal, type MintedToken } from './token-reveal';

interface CreateTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mcpUrl: string;
  /** Called once a token exists, so the list can refresh. The token itself is not passed. */
  onCreated: () => void;
}

type Step = 'form' | 'code' | 'token';

const EXPIRY_OPTIONS = EXPIRY_CHOICES.map((d) => ({ value: String(d), label: `${d} days` }));

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * Three steps: choose, enter the emailed code, see the token once. The token lives
 * only in this component's state, and is dropped when the dialog closes.
 */
export function CreateTokenDialog(props: CreateTokenDialogProps) {
  // Mounting a fresh body per open means a closed dialog holds no token and no code.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <CreateTokenBody {...props} />}
    </Dialog>
  );
}

function CreateTokenBody({ onOpenChange, mcpUrl, onCreated }: CreateTokenDialogProps) {
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [canRead, setCanRead] = useState(true);
  const [canPropose, setCanPropose] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryDays>(DEFAULT_EXPIRY);
  const [codeExpiresAt, setCodeExpiresAt] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<MintedToken | null>(null);

  const scopes: AgentScope[] = [...(canRead ? (['read'] as const) : []), ...(canPropose ? (['bills:write'] as const) : [])];
  const close = () => onOpenChange(false);

  const requestCode = async (resend: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { res, data } = await postJson('/api/agent-tokens', {
        name: name.trim(),
        scopes,
        expires_in_days: expiry,
      });
      if (!res.ok) {
        setError(tokenErrorMessage(data.code, data));
        return;
      }
      setCodeExpiresAt(data.code_expires_at ?? null);
      setCode('');
      if (resend) setNotice('A new code is on its way. The old one no longer works.');
      setStep('code');
    } catch {
      setError(tokenErrorMessage(undefined));
    } finally {
      setBusy(false);
    }
  };

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError('Give the token a name, such as the name of the agent or the laptop it runs on.');
      return;
    }
    if (scopes.length === 0) {
      setError('Pick at least one thing the token may do.');
      return;
    }
    void requestCode(false);
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { res, data } = await postJson('/api/agent-tokens/verify', { code });
      if (!res.ok) {
        if (data.code === 'wrong_code') setCode('');
        setError(tokenErrorMessage(data.code, data));
        return;
      }
      setToken(data as MintedToken);
      setCode('');
      setStep('token');
      onCreated();
    } catch {
      setError(tokenErrorMessage(undefined));
    } finally {
      setBusy(false);
    }
  };

  const locked = step === 'token';

  return (
    <DialogContent
      className={`${DIALOG_SURFACE} max-h-[92dvh] overflow-y-auto [&>*]:min-w-0`}
      showCloseButton={!locked}
      onInteractOutside={(e) => locked && e.preventDefault()}
      onEscapeKeyDown={(e) => locked && e.preventDefault()}
    >
      {step === 'form' && (
        <>
          <DialogHeader className="gap-1.5 text-left">
            <DialogTitle className="text-lg font-semibold tracking-tight text-white">New agent token</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-white/50">
              A token is a password for one AI agent. You choose what it may do, and you can turn it off at any time.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="space-y-6">
            <Field htmlFor="agent-token-name" label="Name" helper="So you can tell your tokens apart.">
              <Input
                id="agent-token-name"
                value={name}
                maxLength={60}
                placeholder="e.g., Claude Code on my laptop"
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                className={FIELD_INPUT}
              />
            </Field>

            <Field label="What it can do">
              <div className="space-y-3">
                <div>
                  <ChoicePill selected={canRead} onClick={() => setCanRead(!canRead)}>
                    Read
                  </ChoicePill>
                  <p className="mt-1.5 text-xs text-white/40">{SCOPE_LABELS.read}.</p>
                </div>
                <div>
                  <ChoicePill selected={canPropose} onClick={() => setCanPropose(!canPropose)}>
                    Propose bills
                  </ChoicePill>
                  <p className="mt-1.5 text-xs text-white/40">
                    The agent can draft a bill. Nobody can see the draft until you open it on Splittr and press
                    Approve. Off unless you turn it on.
                  </p>
                </div>
              </div>
            </Field>

            <Field label="Stops working after">
              <Segmented
                ariaLabel="How long the token lasts"
                options={EXPIRY_OPTIONS}
                value={String(expiry)}
                onChange={(v) => setExpiry(Number(v) as ExpiryDays)}
              />
            </Field>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-3">
              <Button type="submit" size="lg" disabled={busy} className="w-full">
                {busy ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Sending code...
                  </>
                ) : (
                  'Email me a code'
                )}
              </Button>
              <p className="text-xs leading-relaxed text-white/35">
                To make sure it is you, we email a 6-digit code to the address on this account.
              </p>
            </div>
          </form>
        </>
      )}

      {step === 'code' && (
        <>
          <DialogHeader className="gap-1.5 text-left">
            <DialogTitle className="text-lg font-semibold tracking-tight text-white">Check your email</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-white/50">
              Enter the 6-digit code we emailed you.
              {codeExpiresAt && ` It works until ${formatClock(codeExpiresAt)}.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCode} className="space-y-5">
            <Field
              htmlFor="agent-token-code"
              label="Code"
              helper="Never share this code. Splittr will never ask you for it."
            >
              <Input
                id="agent-token-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                autoFocus
                className={`${FIELD_INPUT} h-12 text-center font-mono text-xl tracking-[0.4em] tabular-nums`}
              />
            </Field>

            {notice && <p className="text-sm text-white/60">{notice}</p>}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" disabled={busy || code.length !== 6} className="w-full">
              {busy ? (
                <>
                  <Loader2 className="animate-spin" />
                  Checking...
                </>
              ) : (
                'Create token'
              )}
            </Button>
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                className="-ml-4 text-white/60 hover:text-white"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setStep('form');
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="-mr-4 text-white/60 hover:text-white"
                disabled={busy}
                onClick={() => void requestCode(true)}
              >
                Send a new code
              </Button>
            </div>
          </form>
        </>
      )}

      {step === 'token' && token && <TokenReveal token={token} mcpUrl={mcpUrl} onDone={close} />}
    </DialogContent>
  );
}
