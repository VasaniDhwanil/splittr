import { Suspense } from 'react';
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import JoinClient from './join-client';

// Member counts change; build the invite preview per request.
export const dynamic = 'force-dynamic';

const ROBOTS: Metadata['robots'] = { index: false, follow: false };

const GENERIC_TITLE = 'Join a group on Splittr';
const GENERIC_DESCRIPTION = 'Sign in to join the group and keep your bills together.';

const GENERIC: Metadata = {
  title: { absolute: GENERIC_TITLE },
  description: GENERIC_DESCRIPTION,
  robots: ROBOTS,
  openGraph: {
    title: GENERIC_TITLE,
    description: GENERIC_DESCRIPTION,
    url: '/groups/join',
    type: 'website',
    siteName: 'Splittr',
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title: GENERIC_TITLE, description: GENERIC_DESCRIPTION },
};

// Invite codes come from generateShortCode(8): unambiguous uppercase + digits.
const CODE_RE = /^[A-Z0-9]{4,16}$/;

interface InviteGroupRow {
  id: string;
  name: string | null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const raw = (await searchParams).code;
  const code = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return GENERIC;

  try {
    const db = createAdminClient();
    const { data: group } = await db
      .from('groups')
      .select('id, name')
      .eq('invite_code', code)
      .maybeSingle<InviteGroupRow>();
    if (!group) return GENERIC;

    const { count } = await db
      .from('group_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('group_id', group.id);

    const name = group.name?.trim() || 'a group';
    const members = count ?? 0;
    const title = `Join ${name} on Splittr`;
    const description = `You’re invited to ${name}. ${members} member${members === 1 ? '' : 's'}. Sign in to join and keep your bills together.`;

    return {
      title: { absolute: title },
      description,
      robots: ROBOTS,
      openGraph: {
        title,
        description,
        url: `/groups/join?code=${encodeURIComponent(code)}`,
        type: 'website',
        siteName: 'Splittr',
        locale: 'en_US',
      },
      twitter: { card: 'summary_large_image', title, description },
    };
  } catch {
    return GENERIC;
  }
}

export default function GroupJoinPage() {
  return (
    <Suspense>
      <JoinClient />
    </Suspense>
  );
}
