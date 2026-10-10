# Referral Bounty Tracker

**Role:** product owner, builder. **Shipped:** September 3 and 4, 2026. **Stack:** TypeScript, Hono, React, Neon Postgres via neon-http, MongoDB (read-only).

## The problem

A seasonal promotion: referrals made in a two-month window that reach a GMV threshold by the deadline earn the referring affiliate a larger-than-usual bounty. Staff needed to see, in one card, who opted in, how many referrals each had made, which qualified, and what the promotion was costing.

Two data problems made it non-trivial:

1. **Gross take per organization has no warehouse column.** The promo cost is a percentage of Posh's own fee on each qualified organization's orders. That had to be computed live from the product database's order documents, applying the same hygiene filters the finance reports use.
2. **The warehouse's GMV is monthly-grain and a day stale.** Good enough as a labeled fallback, not good enough as the number a bounty is paid on.

## What I built

A staff-visible, admin-editable card:

- Roster rows with Intros, Referrals, Qualified, GMV, and promo cost. Window, threshold, and rate are editable in-card, clamped and echoed server-side.
- GMV and take computed live from order documents, with the warehouse figure shown as a labeled fallback when the live lookup fails.
- Promo-cost total, visible to staff only. Counts can be exposed publicly later; GMV, take, and cost never can, and the public payload tripwire from the community site enforces that.
- Soft removal from the roster, so re-adding someone keeps their manual counts.
- The tables are keyed by a promotion id so the next seasonal promo reuses them.

### Intros versus referrals

The owner's correction on the first version is worth recording because it is a domain-model lesson: *intros* (introductions the owner makes by text or email before anything exists in the system) and *referrals* (tracked by the lifecycle engine) are different things and must never be merged into one number. Intros got their own manually incremented column to the left of Referrals. When an intro later becomes a tracked referral, the owner decrements the intro count by hand. Intros carry no GMV and no cost.

### Atomic round-robin assignment

Each intro also needs to be assigned to an account executive, rotating through a configurable list. The obvious design stores a pointer. The better design *derives* it: the pointer is the count of non-undone assignments modulo the rotation length. Then:

- "+1" is one SQL statement: a CTE that bumps the counter, computes the slot, and inserts the assignment, returning both.
- "Undo last" is one SQL statement too, pinned to the assignment id the admin saw in the confirmation dialog. If that row is no longer the latest, nothing is touched and the UI refreshes instead of guessing. A concurrent duplicate undo is a no-op rather than a double-decrement.
- Nothing can drift, because there is no stored pointer to drift.

Single statements matter here because the neon-http driver has no cross-statement transactions. A split version could mark a row undone, fail the decrement, and send the natural retry after the *wrong* assignment. The pattern is extracted as [`atomic-round-robin`](../packages/atomic-round-robin).

## Outcome

The card sits on the staff community dashboard beside the lifecycle engine. The bounty tables were reused two weeks later as the standings basis for the Arts & Fashion challenge, with the window predicate and the live GMV lookup reduced to a single "activated" boolean so no revenue figure ever reached the public page.
