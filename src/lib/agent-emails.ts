/**
 * Email for agent access: the code that proves inbox control before a token
 * is created, and the notices that tell the owner when something happened to
 * one. Token names are typed by the user, so they are escaped everywhere.
 */
import { emailShell, escapeHtml } from '@/lib/email';
import type { AgentScope } from '@/lib/agent-tokens';

interface Email {
  subject: string;
  html: string;
  text: string;
}

export const SCOPE_LABEL: Record<AgentScope, string> = {
  read: 'Read your bills, groups and balances',
  'bills:write': 'Propose new bills (each one waits for your approval)',
};

const heading = (text: string) => `
        <tr>
          <td style="padding:28px 40px 8px 40px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">${text}</h1>
          </td>
        </tr>`;

const paragraph = (html: string, muted = false) => `
        <tr>
          <td style="padding:0 40px 16px 40px;">
            <p style="margin:0;font-size:${muted ? 12 : 14}px;color:rgba(255,255,255,${muted ? 0.35 : 0.55});line-height:1.6;">${html}</p>
          </td>
        </tr>`;

const button = (href: string, label: string) => `
        <tr>
          <td style="padding:8px 40px 16px 40px;">
            <a href="${href}"
               style="display:block;text-align:center;background:#ffffff;color:#000000;text-decoration:none;font-size:15px;font-weight:600;padding:14px 24px;border-radius:9999px;">
              ${label}
            </a>
          </td>
        </tr>`;

const spacer = `
        <tr><td style="padding:0 0 24px 0;"></td></tr>`;

const scopeList = (scopes: AgentScope[]) => scopes.map((scope) => SCOPE_LABEL[scope]);

export function buildAgentCodeEmail(input: {
  tokenName: string;
  scopes: AgentScope[];
  code: string;
  ip: string;
  minutes: number;
}): Email {
  const name = escapeHtml(input.tokenName);
  const can = scopeList(input.scopes);
  const body =
    heading('Your code to create an agent token') +
    `
        <tr>
          <td style="padding:8px 40px 20px 40px;">
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#4ade80;">${input.code}</div>
          </td>
        </tr>` +
    paragraph(
      `Enter it on splittr.cash to create the token <strong style="color:#ffffff;">${name}</strong>. An agent holding that token can:<br />${can
        .map((line) => `&bull; ${escapeHtml(line)}`)
        .join('<br />')}`
    ) +
    paragraph(
      `<strong style="color:#ffffff;">Never share this code.</strong> Splittr will never ask for it by email, phone or chat. Anyone who has it can give their own agent access to your account.`
    ) +
    paragraph(
      `Requested from around ${escapeHtml(input.ip)}. The code works for ${input.minutes} minutes. If this wasn&rsquo;t you, ignore this email: nothing is created without the code.`,
      true
    ) +
    spacer;

  return {
    subject: 'Your code to create a Splittr agent token',
    html: emailShell(body),
    text: [
      `Your code to create a Splittr agent token: ${input.code}`,
      '',
      `Enter it on splittr.cash to create the token "${input.tokenName}". An agent holding that token can:`,
      ...can.map((line) => `- ${line}`),
      '',
      'Never share this code. Splittr will never ask for it by email, phone or chat.',
      '',
      `Requested from around ${input.ip}. The code works for ${input.minutes} minutes. If this wasn't you, ignore this email: nothing is created without the code.`,
    ].join('\n'),
  };
}

export function buildAgentTokenCreatedEmail(input: {
  tokenName: string;
  scopes: AgentScope[];
  ip: string;
  revokeUrl: string;
}): Email {
  const name = escapeHtml(input.tokenName);
  const can = scopeList(input.scopes);
  const body =
    heading('A new agent token was created') +
    paragraph(
      `The token <strong style="color:#ffffff;">${name}</strong> now gives an AI agent access to your Splittr account, from around ${escapeHtml(input.ip)}. It can:<br />${can
        .map((line) => `&bull; ${escapeHtml(line)}`)
        .join('<br />')}`
    ) +
    paragraph('If you created it, there is nothing to do.') +
    button(input.revokeUrl, 'Not you? Revoke agent tokens') +
    paragraph(
      'That page asks you to confirm before anything is revoked. You can also manage tokens under Agent access on your Splittr profile.',
      true
    ) +
    spacer;

  return {
    subject: 'A new agent token was created on your Splittr account',
    html: emailShell(body),
    text: [
      `The agent token "${input.tokenName}" was created on your Splittr account, from around ${input.ip}. It can:`,
      ...can.map((line) => `- ${line}`),
      '',
      'If you created it, there is nothing to do.',
      '',
      `Not you? Revoke agent tokens: ${input.revokeUrl}`,
    ].join('\n'),
  };
}

export function buildAgentTokenStoppedEmail(input: {
  tokenName: string;
  /** 'revoked' is permanent, 'suspended' can be undone by the owner. */
  state: 'revoked' | 'suspended';
  reason: string;
  profileUrl: string;
}): Email {
  const name = escapeHtml(input.tokenName);
  const title =
    input.state === 'revoked' ? 'An agent token was revoked' : 'An agent token was paused';
  const next =
    input.state === 'revoked'
      ? 'It no longer works. Create a new one under Agent access on your profile if you still need it.'
      : 'It will not work until you turn it back on under Agent access on your profile. If you do not recognise what the agent was doing, revoke it instead.';
  const body =
    heading(title) +
    paragraph(`Your token <strong style="color:#ffffff;">${name}</strong>: ${escapeHtml(input.reason)}`) +
    paragraph(escapeHtml(next)) +
    button(input.profileUrl, 'Open Agent access') +
    spacer;

  return {
    subject: `${title} on your Splittr account`,
    html: emailShell(body),
    text: [`${title}: "${input.tokenName}".`, '', input.reason, '', next, '', input.profileUrl].join('\n'),
  };
}

/** The phishing warning shown on the consent page, repeated in the inbox. */
export const OAUTH_PHISHING_WARNING =
  'Only continue if you pressed Connect in Claude on this device in the last few minutes. If someone sent you this link, stop: approving would give their Claude access to your Splittr.';

export function buildOAuthConsentCodeEmail(input: {
  /** What the person is connecting: "claude.ai" or "an app on this computer, such as Claude Code". */
  destination: string;
  accountEmail: string;
  scopes: AgentScope[];
  code: string;
  ip: string;
  minutes: number;
}): Email {
  const can = scopeList(input.scopes);
  const body =
    heading('Your code to connect Claude to Splittr') +
    `
        <tr>
          <td style="padding:8px 40px 20px 40px;">
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#4ade80;">${escapeHtml(input.code)}</div>
          </td>
        </tr>` +
    paragraph(
      `Enter it on splittr.cash to connect <strong style="color:#ffffff;">${escapeHtml(input.destination)}</strong> to the Splittr account <strong style="color:#ffffff;">${escapeHtml(input.accountEmail)}</strong>. Claude asked to be able to:<br />${can
        .map((line) => `&bull; ${escapeHtml(line)}`)
        .join('<br />')}`
    ) +
    paragraph(`<strong style="color:#ffffff;">${escapeHtml(OAUTH_PHISHING_WARNING)}</strong>`) +
    paragraph(
      `<strong style="color:#ffffff;">Never share this code.</strong> Splittr will never ask for it by email, phone or chat.`
    ) +
    paragraph(
      `Requested from around ${escapeHtml(input.ip)}. The code works for ${input.minutes} minutes. If this wasn&rsquo;t you, ignore this email: nothing is connected without the code.`,
      true
    ) +
    spacer;

  return {
    subject: 'Your code to connect Claude to Splittr',
    html: emailShell(body),
    text: [
      `Your code to connect Claude to Splittr: ${input.code}`,
      '',
      `Enter it on splittr.cash to connect ${input.destination} to the Splittr account ${input.accountEmail}. Claude asked to be able to:`,
      ...can.map((line) => `- ${line}`),
      '',
      OAUTH_PHISHING_WARNING,
      '',
      'Never share this code. Splittr will never ask for it by email, phone or chat.',
      '',
      `Requested from around ${input.ip}. The code works for ${input.minutes} minutes. If this wasn't you, ignore this email: nothing is connected without the code.`,
    ].join('\n'),
  };
}

export function buildOAuthConnectedEmail(input: {
  clientLabel: string;
  destination: string;
  accountEmail: string;
  scopes: AgentScope[];
  ip: string;
  revokeUrl: string;
}): Email {
  const can = scopeList(input.scopes);
  const body =
    heading(`${escapeHtml(input.clientLabel)} was connected to your Splittr account`) +
    paragraph(
      `<strong style="color:#ffffff;">${escapeHtml(input.destination)}</strong> was connected to <strong style="color:#ffffff;">${escapeHtml(input.accountEmail)}</strong>, approved from around ${escapeHtml(input.ip)}. It can:<br />${can
        .map((line) => `&bull; ${escapeHtml(line)}`)
        .join('<br />')}`
    ) +
    paragraph('If you connected it, there is nothing to do.') +
    button(input.revokeUrl, 'Not you? Disconnect everything') +
    paragraph(
      'That page asks you to confirm before anything is revoked. You can also manage connections under Agent access on your Splittr profile.',
      true
    ) +
    spacer;

  return {
    subject: `${input.clientLabel} was connected to your Splittr account`,
    html: emailShell(body),
    text: [
      `${input.destination} was connected to ${input.accountEmail} (${input.clientLabel}), approved from around ${input.ip}. It can:`,
      ...can.map((line) => `- ${line}`),
      '',
      'If you connected it, there is nothing to do.',
      '',
      `Not you? Disconnect everything: ${input.revokeUrl}`,
    ].join('\n'),
  };
}
