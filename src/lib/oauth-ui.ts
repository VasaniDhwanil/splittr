// Copy for the connect-Claude screens. Client-safe: no Node imports.

export type OAuthDestination = 'claude.ai' | 'loopback';

export const PHISHING_WARNING =
  'Only continue if you pressed Connect in Claude on this device in the last few minutes. If someone sent you this link, stop: approving would give their Claude access to your Splittr.';

export const LOOPBACK_WARNING =
  'Any program running on this computer could be asking, not only Claude Code. If you did not just start this from Claude Code, press Deny.';

export const REQUEST_GONE_TEXT =
  'This sign-in request has expired or was opened somewhere else. Go back to Claude and press Connect again.';

/** Who is asking, named from where the answer goes, never from the client's own words. */
export function askerText(destination: OAuthDestination): string {
  return destination === 'claude.ai'
    ? 'Claude (claude.ai, the Desktop app and the mobile apps)'
    : 'An app on this computer, such as Claude Code';
}

/** What a connection is called in lists and in the replace option. */
export function connectionName(destination: OAuthDestination | null | undefined): string {
  return destination === 'loopback' ? 'Claude Code' : 'Claude';
}

/** The row title in the profile list. */
export function connectionTitle(destination: OAuthDestination | null | undefined): string {
  return destination === 'loopback' ? 'Claude Code on a computer' : 'Claude (claude.ai)';
}

/** "23 hours", "40 minutes": how long until something unlocks. */
export function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'a little while';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** Plain-words message for each error the consent routes answer. */
export function consentErrorMessage(
  code: string | undefined,
  body: { attempts_left?: number; retry_after?: number } = {}
): string {
  switch (code) {
    case 'wrong_code': {
      const n = body.attempts_left;
      if (typeof n === 'number') {
        return n > 0
          ? `That code is not right. ${n} ${n === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right, and you are out of tries. Ask for a new code.';
      }
      return 'That code is not right.';
    }
    case 'code_required':
      return 'Enter the 6-digit code we emailed you. If it has expired or you are out of tries, ask for a new one.';
    case 'locked':
      return `Connecting is paused after too many wrong codes. It unlocks in ${formatWait(body.retry_after ?? 0)}, or sooner if you sign in again with an emailed link.`;
    case 'rate_limited':
      return `You have asked for too many codes. Try again in ${formatWait(body.retry_after ?? 0)}.`;
    case 'email_unavailable':
      return 'We could not send the email just now. Nothing was changed. Try again in a little while.';
    case 'invalid_input':
      return 'Something about that choice was not accepted. Reload this page and try again.';
    default:
      return 'Something went wrong on our side. Please try again.';
  }
}
