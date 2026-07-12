/**
 * Server-side email sending via Resend.
 *
 * Uses the REST API directly (no SDK dependency) so it works in any runtime.
 * Requires RESEND_API_KEY. Sends from the verified splittr.cash domain — set
 * EMAIL_FROM to override the default sender.
 *
 * NEVER import this from a client component: it reads a secret.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Splittr <no-reply@splittr.cash>';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Email is not configured (RESEND_API_KEY missing)' };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        (data && (data.message || data.name)) || `Resend responded ${res.status}`;
      return { ok: false, error: String(message) };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Wrap body content in the Splittr dark email shell — mirrors the visual
 * language of supabase/email-templates/magic-link.html so auth and app mail
 * look like one product.
 */
function emailShell(bodyHtml: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#111111;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:40px 40px 0 40px;">
            <div style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
              Split<span style="background:linear-gradient(90deg,#6ee7b7,#4ade80,#bef264);-webkit-background-clip:text;background-clip:text;color:#4ade80;">tr</span>
            </div>
          </td>
        </tr>
        ${bodyHtml}
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
        <tr>
          <td style="padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.25);">Splittr &middot; Split bills without the awkward math</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export interface GroupInviteEmail {
  groupName: string;
  inviterName: string;
  joinUrl: string;
}

/** Build subject/html/text for a "you've been invited to a group" email. */
export function buildGroupInviteEmail(input: GroupInviteEmail): {
  subject: string;
  html: string;
  text: string;
} {
  const { groupName, inviterName, joinUrl } = input;
  const safeName = escapeHtml(groupName);
  const safeInviter = escapeHtml(inviterName);

  const body = `
        <tr>
          <td style="padding:28px 40px 8px 40px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">${safeInviter} invited you to a group</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 24px 40px;">
            <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.6;">
              Join <strong style="color:#ffffff;">${safeName}</strong> on Splittr to split bills and settle up — no awkward math, no spreadsheets.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 8px 40px;">
            <a href="${joinUrl}"
               style="display:block;text-align:center;background:#ffffff;color:#000000;text-decoration:none;font-size:15px;font-weight:600;padding:14px 24px;border-radius:9999px;">
              Join ${safeName}
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 40px 40px;">
            <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.35);line-height:1.6;">
              If you weren&rsquo;t expecting this, you can safely ignore this email.
            </p>
            <p style="margin:16px 0 0 0;font-size:12px;color:rgba(255,255,255,0.35);line-height:1.6;word-break:break-all;">
              Or paste this link into your browser:<br />
              <a href="${joinUrl}" style="color:#4ade80;text-decoration:none;">${joinUrl}</a>
            </p>
          </td>
        </tr>`;

  return {
    subject: `${inviterName} invited you to “${groupName}” on Splittr`,
    html: emailShell(body),
    text: `${inviterName} invited you to join "${groupName}" on Splittr.\n\nJoin here: ${joinUrl}\n\nIf you weren't expecting this, you can safely ignore this email.\n\nSplittr — Split bills without the awkward math`,
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
