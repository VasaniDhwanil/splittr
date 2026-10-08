import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BillRow } from '@/components/groups/bill-row';
import { GroupCard } from '@/components/groups/group-card';
import { GroupHeader } from '@/components/groups/group-header';
import { MemberList, type MemberListItem } from '@/components/groups/member-list';
import { Section } from '@/components/groups/section';
import { StatusDot } from '@/components/groups/status-dot';

const RECENT = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

describe('BillRow', () => {
  it('renders the name as a link to the bill', () => {
    render(<BillRow id="b-42" name="Taco Night" createdAt={RECENT} />);
    const link = screen.getByRole('link', { name: 'Taco Night' });
    expect(link).toHaveAttribute('href', '/bill/b-42');
  });

  it('renders status, date, total, people count and role', () => {
    render(
      <BillRow
        id="b-1"
        name="Dinner"
        createdAt={RECENT}
        status="active"
        total={1234.5}
        peopleCount={4}
        role="Host"
      />
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('3 days ago')).toBeInTheDocument();
    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
    expect(screen.getByText('4 people')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });

  it('uses the singular for one person and shows Settled', () => {
    render(<BillRow id="b-1" name="Lunch" createdAt={RECENT} status="settled" peopleCount={1} />);
    expect(screen.getByText('1 person')).toBeInTheDocument();
    expect(screen.getByText('Settled')).toBeInTheDocument();
  });

  it('omits status, total, people and role when not given', () => {
    render(<BillRow id="b-1" name="Lunch" createdAt={RECENT} />);
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByText('Settled')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/people|person/)).not.toBeInTheDocument();
  });

  it('shows Archived and dims the row when archived', () => {
    const { container } = render(<BillRow id="b-1" name="Old" createdAt={RECENT} archived />);
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('opacity-60');
  });

  it('renders the action slot', () => {
    const onArchive = vi.fn();
    render(
      <BillRow
        id="b-1"
        name="Dinner"
        createdAt={RECENT}
        action={
          <button type="button" onClick={onArchive}>
            Archive
          </button>
        }
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });
});

describe('StatusDot', () => {
  it('reads Settled for settled bills', () => {
    render(<StatusDot status="settled" />);
    expect(screen.getByText('Settled')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('reads Active for anything else', () => {
    const { rerender } = render(<StatusDot status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    rerender(<StatusDot status="draft" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('Settled')).not.toBeInTheDocument();
  });
});

describe('GroupCard', () => {
  it('links to the group and includes the member count when provided', () => {
    render(<GroupCard id="g-1" name="Roommates" memberCount={3} billCount={5} totalAmount={250} activeCount={2} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/groups/g-1');
    expect(screen.getByRole('heading', { name: 'Roommates' })).toBeInTheDocument();
    expect(screen.getByText('3 members · 5 bills · 2 active')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
  });

  it('omits the member count when not provided and uses singulars', () => {
    render(<GroupCard id="g-1" name="Trip" billCount={1} totalAmount={10} activeCount={0} />);
    expect(screen.getByText('1 bill')).toBeInTheDocument();
    expect(screen.queryByText(/member/)).not.toBeInTheDocument();
  });

  it('uses the singular for one member', () => {
    render(<GroupCard id="g-1" name="Solo" memberCount={1} billCount={2} totalAmount={10} activeCount={0} />);
    expect(screen.getByText('1 member · 2 bills')).toBeInTheDocument();
  });

  it('hides the total when there are no bills', () => {
    render(<GroupCard id="g-1" name="Empty" memberCount={2} billCount={0} totalAmount={0} activeCount={0} />);
    expect(screen.getByText('2 members · 0 bills')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});

describe('MemberList', () => {
  const members: MemberListItem[] = [
    { id: 'm-1', name: 'Alice Owner', isYou: false, isOwner: true, hasPaymentHandles: true },
    { id: 'm-2', name: 'Bob Self', isYou: true, isOwner: false, hasPaymentHandles: true },
    { id: 'm-3', name: 'Cara Nohandles', isYou: false, isOwner: false, hasPaymentHandles: false },
  ];

  function rowFor(name: string): HTMLElement {
    const row = screen.getByText(name, { exact: false }).closest('li');
    if (!row) throw new Error(`no row for ${name}`);
    return row;
  }

  it('renders one row per member', () => {
    render(<MemberList members={members} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('captions owners with Owner', () => {
    render(<MemberList members={members} />);
    expect(screen.getAllByText('Owner')).toHaveLength(1);
    expect(within(rowFor('Alice Owner')).getByText('Owner')).toBeInTheDocument();
  });

  it('marks the current user with "you"', () => {
    render(<MemberList members={members} />);
    expect(screen.getAllByText('you')).toHaveLength(1);
    expect(within(rowFor('Bob Self')).getByText('you')).toBeInTheDocument();
  });

  it('shows "No payment handles" only for members without handles', () => {
    render(<MemberList members={members} />);
    expect(screen.getAllByText('No payment handles')).toHaveLength(1);
    expect(within(rowFor('Cara Nohandles')).getByText('No payment handles')).toBeInTheDocument();
  });
});

describe('GroupHeader', () => {
  function renderHeader(isOwner: boolean) {
    const handlers = { onInvite: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onLeave: vi.fn() };
    render(<GroupHeader name="Roommates" meta={['4 members', '12 bills']} isOwner={isOwner} {...handlers} />);
    return handlers;
  }

  it('renders the name and meta line', () => {
    renderHeader(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Roommates' })).toBeInTheDocument();
    expect(screen.getByText('4 members · 12 bills')).toBeInTheDocument();
  });

  it('shows Invite, rename and delete for owners and wires their callbacks', () => {
    const h = renderHeader(true);
    expect(screen.queryByRole('button', { name: 'Leave group' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /invite/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));

    expect(h.onInvite).toHaveBeenCalledTimes(1);
    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(h.onLeave).not.toHaveBeenCalled();
  });

  it('shows Invite and leave for non-owners and wires their callbacks', () => {
    const h = renderHeader(false);
    expect(screen.queryByRole('button', { name: 'Rename group' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete group' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /invite/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave group' }));

    expect(h.onInvite).toHaveBeenCalledTimes(1);
    expect(h.onLeave).toHaveBeenCalledTimes(1);
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(h.onDelete).not.toHaveBeenCalled();
  });
});

describe('Section (renders through framer-motion Reveal)', () => {
  it('renders title, count, description, action and children', () => {
    render(
      <Section title="Members" count={4} description="People in this group" action={<button type="button">Add</button>}>
        <p>child content</p>
      </Section>
    );
    expect(screen.getByRole('heading', { level: 2, name: /Members/ })).toHaveTextContent('Members 4');
    expect(screen.getByText('People in this group')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByText('child content')).toBeInTheDocument();
  });
});
