import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { buildGroupInviteEmail, sendEmail, isEmailConfigured } from '@/lib/email';

// Basic RFC-5322-ish email shape; the real check is Resend accepting it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Best-effort public origin for building the join link inside the email. */
function originFrom(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

// Email a group invite (with the join link) to someone.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params;
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Sign in to send invites' }, { status: 401 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json(
        { error: 'Email sending is not configured' },
        { status: 503 }
      );
    }

    // Throttle: per user and per IP, since this sends real mail.
    const ip = clientIp(request);
    const perUser = rateLimit(`invite:user:${user.id}`, 10, 60 * 60 * 1000); // 10/hour
    const perIp = rateLimit(`invite:ip:${ip}`, 20, 60 * 60 * 1000); // 20/hour
    if (!perUser.allowed || !perIp.allowed) {
      const retryAfter = Math.max(perUser.retryAfterSeconds, perIp.retryAfterSeconds);
      return NextResponse.json(
        { error: 'Too many invites sent. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    // Caller must be a member of this group to invite others.
    const { data: myMembership } = await db
      .from('group_members')
      .select('display_name')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!myMembership) {
      return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 });
    }

    const { data: group } = await db
      .from('groups')
      .select('name, emoji, invite_code')
      .eq('id', groupId)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const inviterName =
      myMembership.display_name || user.email?.split('@')[0] || 'A friend';
    const joinUrl = `${originFrom(request)}/groups/join?code=${group.invite_code}`;

    const { subject, html, text } = buildGroupInviteEmail({
      groupName: group.name,
      groupEmoji: group.emoji,
      inviterName,
      joinUrl,
    });

    const result = await sendEmail({
      to: email,
      subject,
      html,
      text,
      replyTo: user.email ?? undefined,
    });

    if (!result.ok) {
      console.error('Failed to send group invite:', result.error);
      return NextResponse.json({ error: 'Could not send the invite email' }, { status: 502 });
    }

    return NextResponse.json({ sent: true, to: email });
  } catch (error) {
    console.error('Error in groups/[id]/invite POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
