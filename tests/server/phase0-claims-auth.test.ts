import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as claim, DELETE as unclaim } from '@/app/api/claims/route';
import { POST as batchClaim } from '@/app/api/claims/batch/route';
import { createBill, createUser, db, joinBill, request, type TestBill } from './helpers/db';
import { signInAs, signOut, type TestUser } from './helpers/session';

// P2: changing claims on a bill requires being on that bill (a participant
// credential or a matching session) or being its creator.

let bill: TestBill;
let otherBill: TestBill;
let guest: { id: string; token: string | null };
let friend: { id: string; token: string | null };
let legacyGuest: { id: string; token: string | null };
let linked: { id: string; token: string | null };
let outsideGuest: { id: string; token: string | null };
let creatorUser: TestUser;
let linkedUser: TestUser;
let unrelatedUser: TestUser;

const claimsOn = async (itemId: string) => {
  const { data } = await db().from('item_claims').select('participant_id, share').eq('item_id', itemId);
  return data ?? [];
};

const postClaim = (body: unknown, headers: Record<string, string> = {}) =>
  claim(request('POST', '/api/claims', { body, headers }));

const postBatch = (body: unknown, headers: Record<string, string> = {}) =>
  batchClaim(request('POST', '/api/claims/batch', { body, headers }));

const deleteClaim = (participantId: string, itemId: string, headers: Record<string, string> = {}) =>
  unclaim(request('DELETE', `/api/claims?participant_id=${participantId}&item_id=${itemId}`, { headers }));

beforeAll(async () => {
  creatorUser = await createUser('creator');
  linkedUser = await createUser('linked');
  unrelatedUser = await createUser('unrelated');
  bill = await createBill({ creator: creatorUser });
  otherBill = await createBill();
  guest = await joinBill(bill.id, { name: 'Guest' });
  friend = await joinBill(bill.id, { name: 'Friend' });
  legacyGuest = await joinBill(bill.id, { name: 'Legacy', withToken: false });
  linked = await joinBill(bill.id, { name: 'Linked', user: linkedUser, withToken: false });
  outsideGuest = await joinBill(otherBill.id, { name: 'Elsewhere' });
});

beforeEach(async () => {
  signOut();
  await db().from('item_claims').delete().in('item_id', bill.itemIds);
});

describe('callers who are not on the bill', () => {
  it('cannot claim, split or unclaim without any credential', async () => {
    const [pasta] = bill.itemIds;
    await db().from('item_claims').insert({ participant_id: guest.id, item_id: pasta, share: 1 });

    expect((await postClaim({ participant_id: friend.id, item_id: pasta, share: 1 })).status).toBe(403);
    expect(
      (await postBatch({ item_id: pasta, entries: [{ participant_id: friend.id, share: 1 }] })).status
    ).toBe(403);
    expect((await deleteClaim(guest.id, pasta)).status).toBe(403);

    expect(await claimsOn(pasta)).toEqual([{ participant_id: guest.id, share: 1 }]);
  });

  it('cannot use a participant token from another bill', async () => {
    const [pasta] = bill.itemIds;
    const res = await postClaim(
      { participant_id: guest.id, item_id: pasta, share: 1 },
      { 'X-Participant-Token': outsideGuest.token! }
    );
    expect(res.status).toBe(403);
    expect(await claimsOn(pasta)).toEqual([]);
  });

  it('cannot use a session that is not on the bill', async () => {
    const [pasta] = bill.itemIds;
    signInAs(unrelatedUser);
    expect((await postClaim({ participant_id: guest.id, item_id: pasta, share: 1 })).status).toBe(403);
  });

  it('cannot claim as a guest whose device holds no token (joined before tokens, or another device)', async () => {
    const [pasta] = bill.itemIds;
    expect((await postClaim({ participant_id: legacyGuest.id, item_id: pasta, share: 1 })).status).toBe(403);
  });
});

describe('people on the bill', () => {
  it('claim for themselves with their participant token', async () => {
    const [pasta] = bill.itemIds;
    const res = await postClaim(
      { participant_id: guest.id, item_id: pasta, share: 1 },
      { 'X-Participant-Token': guest.token! }
    );
    expect(res.status).toBe(200);
    expect(await claimsOn(pasta)).toEqual([{ participant_id: guest.id, share: 1 }]);
  });

  it('split an item among other people from the split sheet', async () => {
    const [pasta] = bill.itemIds;
    const res = await postBatch(
      {
        item_id: pasta,
        entries: [
          { participant_id: friend.id, share: 0.5 },
          { participant_id: legacyGuest.id, share: 0.5 },
        ],
      },
      { 'X-Participant-Token': guest.token! }
    );
    expect(res.status).toBe(200);
    expect((await claimsOn(pasta)).map((c) => c.participant_id).sort()).toEqual(
      [friend.id, legacyGuest.id].sort()
    );
  });

  it('unclaim with their participant token', async () => {
    const [pasta] = bill.itemIds;
    await db().from('item_claims').insert({ participant_id: guest.id, item_id: pasta, share: 1 });
    const res = await deleteClaim(guest.id, pasta, { 'X-Participant-Token': guest.token! });
    expect(res.status).toBe(200);
    expect(await claimsOn(pasta)).toEqual([]);
  });

  it('are recognised by their signed-in account without a token', async () => {
    const [pasta] = bill.itemIds;
    signInAs(linkedUser);
    const res = await postClaim({ participant_id: linked.id, item_id: pasta, share: 1 });
    expect(res.status).toBe(200);
  });
});

describe('the bill creator', () => {
  it('claims with the creator token', async () => {
    const [pasta] = bill.itemIds;
    const res = await postClaim(
      { participant_id: bill.creatorParticipantId, item_id: pasta, share: 1 },
      { 'X-Creator-Token': bill.creatorToken }
    );
    expect(res.status).toBe(200);
  });

  it('claims from a signed-in session', async () => {
    const [pasta] = bill.itemIds;
    signInAs(creatorUser);
    const res = await postBatch({
      item_id: pasta,
      entries: [{ participant_id: guest.id, share: 1 }],
    });
    expect(res.status).toBe(200);
  });

  it('cannot use another bill’s creator token', async () => {
    const [pasta] = bill.itemIds;
    const res = await postClaim(
      { participant_id: guest.id, item_id: pasta, share: 1 },
      { 'X-Creator-Token': otherBill.creatorToken }
    );
    expect(res.status).toBe(403);
  });
});
