import { describe, expect, it } from 'vitest';
import { venmoAmount, venmoNote, venmoPayUrl } from '../shared/money';

const TZ = 'America/Detroit';
const NOV3 = '2026-11-04T00:00:00.000Z'; // Tue, Nov 3, 8:00 PM Eastern

/** Read a link back the way Venmo does: exact amount and note, and no "+" anywhere. */
function read(link: string) {
  const query = link.slice(link.indexOf('?') + 1);
  expect(query).not.toContain('+');
  expect(query).not.toMatch(/ /);
  const params = new URLSearchParams(query);
  return { amount: params.get('amount'), note: params.get('note'), recipients: params.get('recipients'), txn: params.get('txn') };
}

describe('Venmo link', () => {
  const cases = [
    { what: 'the usual $14', cents: 1400, name: 'Test person', amount: '14', note: 'Pickleball Tue Nov 3 - Test person' },
    { what: '$9 with the 6-person discount', cents: 900, name: 'Ryan', amount: '9', note: 'Pickleball Tue Nov 3 - Ryan' },
    { what: '$14 after a $5 credit', cents: 900, name: 'Brandon', amount: '9', note: 'Pickleball Tue Nov 3 - Brandon' },
    { what: 'a part-dollar amount', cents: 1450, name: 'Alex', amount: '14.50', note: 'Pickleball Tue Nov 3 - Alex' },
    {
      what: "a long name with an apostrophe",
      cents: 1400,
      name: "Mary-Kate O'Sullivan-Whitmore",
      amount: '14',
      note: "Pickleball Tue Nov 3 - Mary-Kate O'Sullivan-Whitmore",
    },
  ];
  for (const c of cases) {
    it(`${c.what}: exact amount and note in both the app and web links`, () => {
      const note = venmoNote(NOV3, TZ, c.name);
      expect(note).toBe(c.note);
      const pay = venmoPayUrl('https://venmo.com/u/organizer', c.cents, note);
      expect(pay.prefilled).toBe(true);
      expect(pay.url!.startsWith('https://venmo.com/?txn=pay&recipients=organizer&amount=')).toBe(true);
      expect(pay.appUrl!.startsWith('venmo://paycharge?txn=pay&recipients=organizer&amount=')).toBe(true);
      for (const link of [pay.url!, pay.appUrl!]) {
        const got = read(link);
        expect(got).toEqual({ amount: c.amount, note: c.note, recipients: 'organizer', txn: 'pay' });
        // Spaces are %20, and the amount is followed straight by &note, nothing extra.
        expect(link).toContain(`&amount=${c.amount}&note=`);
        expect(link).toContain('Pickleball%20Tue%20Nov%203%20-%20');
      }
    });
  }

  it("the apostrophe is encoded too, so no app can cut the note short", () => {
    const pay = venmoPayUrl('https://venmo.com/organizer', 1400, "Pickleball Tue Nov 3 - O'Neil");
    expect(pay.appUrl).toBe('venmo://paycharge?txn=pay&recipients=organizer&amount=14&note=Pickleball%20Tue%20Nov%203%20-%20O%27Neil');
  });

  it('amounts are only the number: 14, 9, 14.50, never 14.00 or extra digits', () => {
    expect(venmoAmount(1400)).toBe('14');
    expect(venmoAmount(900)).toBe('9');
    expect(venmoAmount(1450)).toBe('14.50');
    expect(venmoAmount(1405)).toBe('14.05');
    expect(venmoAmount(2800)).toBe('28');
  });
});

describe('a fresh sign-up starts the Pay steps over', () => {
  it("I'm out then I'm in again gets a new sign-up time; someone who paid gets the $14 as credit and it pays the new sign-up", async () => {
    const { playerPhone, setupGroup } = await import('./harness');
    const ctx = await setupGroup();
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = d.sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === '2026-11-03');
    const alex = await playerPhone(ctx, 'Alex');
    const mine = async () => (await alex.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id).mine;
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    const first = await mine();
    expect(first.status).toBe('confirmed');
    expect(first.oweCents).toBe(1400);
    expect(typeof first.signupAt).toBe('string');
    ctx.app.now += 60_000;
    await alex.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    ctx.app.now += 60_000;
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    const again = await mine();
    expect(again.signupAt).not.toBe(first.signupAt);
    expect(again.oweCents).toBe(1400);
    // Paid, then out: the $14 is credit right away. In again: a fresh sign-up that owes $14, and the credit pays it as he joins (credit at sign-up is automatic).
    await alex.call('POST', `/api/sessions/${s.id}/paid`, { paid: true });
    // Confirmed by the organizer (since Oct 31 only a confirmed payment turns into credit on a drop).
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    ctx.app.now += 60_000;
    expect((await alex.call('POST', `/api/sessions/${s.id}/withdraw`, {})).data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    ctx.app.now += 60_000;
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    const back = await mine();
    expect(back.signupAt).not.toBe(again.signupAt);
    // The seat is paid again, so the old "$14 is now credit" line is spent (as it was after tapping Use credit).
    expect(back).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true, selfPaid: false, oweCents: 0, useCreditCents: 0, creditCents: 0, creditBackCents: 0 });
    expect((await alex.call('POST', `/api/sessions/${s.id}/use-credit`, {})).status).toBe(409); // nothing left to tap
    expect((await alex.call('GET', '/api/group')).data.credit.balanceCents).toBe(0);
  });
});
