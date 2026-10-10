# Referred-Org Routing in HubSpot

**Role:** designer, analyst, builder (in the CRM's workflow editor), auditor. **Built:** August 12 to 18, 2026. **Audited:** September 29, 2026. **Tools:** HubSpot workflows, calculated properties, association labels, CRM search API, SQL-style CRM queries.

Sometimes the right amount of code is none. This system is CRM configuration, but it required the same data-model rigor as the TypeScript systems, and the audit that followed is the most useful piece of analysis I did all quarter.

## The problem

When an affiliate refers an event organizer and that organizer signs up, someone at Posh should reach out. Who, and how, depends on context: does the organizer already have an open deal? Does the affiliate have a dedicated partnerships manager? Is the affiliate in a strategic vertical? How much revenue do this affiliate's referrals usually generate? Before this, routing was ad hoc, and a golden rule of the CRM made it dangerous to automate carelessly: a contact can be in only one email sequence at a time.

## The waterfall

First match wins. Every exit stamps a `Referral Routing Path` on the contact, which is the reporting cohort key and is never overwritten.

1. Already in an active sequence: skip, but add to a static list so skips stay visible.
2. Organization already has meaningful revenue: skip to a review list. This gate catches late and manual attributions (about 63% of attributions were logged manually, often long after signup) without a blanket "ignore manual" rule, which would have suppressed legitimate outreach.
3. Deal exists: recent activity means a task for the deal owner, no email. Stale means a sequence from the deal owner plus a heads-up task.
4. Affiliate type is campus: parked branch with a stamp, so a future handler has a hook.
5. Affiliate has a partnerships manager: sequence from that manager.
6. Affiliate's vertical is the strategic one: sequence from the verticals specialist.
7. Affiliate's average referral revenue is above a threshold: round-robin to an account executive with a discovery-style email.
8. Otherwise: the self-serve starter kit sequence. Unknowns default *down*.

A companion workflow fires 30 days after any outreach path and stamps `Routing Outcome` as activated or still at zero, with a re-engage task for the latter.

## The threshold analysis

The high-tier threshold came from an analysis of 1,654 true referrals: at $25k average referral revenue, about a third of referral volume routes to account executives and captures about 88% of referred revenue. The owner later lowered it to $10k to be more generous, which moves to about half of volume and 96% of revenue.

The "average referral revenue" property is a CRM calculated rollup, and the single most important detail is the association-label filter: the average must be over companies associated with the label *Referred Group*, because affiliates are also associated to their *own* organization under a different label, and without the filter their own revenue pollutes the average badly.

## The data-model trap

Midway through, the owner caught a flaw: contacts are not associated with their referring affiliate. Only about 20% of referred-organization contacts had any affiliate association, and those pointed to the contact's *own* affiliate identity. Workflow branch filters can traverse only one direct association hop, so three of the branches were dead for most contacts and read the wrong affiliate for the rest.

The fix was to mirror the referrer's type, vertical, and average referral revenue onto the referred company as synced properties (plus a one-time backfill of the referred companies) and re-point the branches at the company. The partnerships-manager branch was the only one that had been correct from the start, because that field was already denormalized onto the company.

## The audit

Six weeks after launch, I audited every referral from the launch date forward by joining the product database's referral records to CRM records on the account id. Of 216 referrals, 120 had enrolled, 8 were in flight or too new, and **88 had been missed**. The causes, in order:

| Cause | Count | Fix owner |
|-------|------:|-----------|
| Company exists but the referrer field was never stamped (the attribution sync only stamps referral-link signups, not invite-flow signups) | 71 | Engineering backfill |
| Contact exists but has no company association | 10 | Engineering |
| Referrer field is stamped but enrollment never fired (API-written property changes do not re-evaluate contact workflows; manual edits do) | 3 | Workflow redesign |
| Stamp landed on a twin or wrong organization | 2 | Case-by-case |
| No CRM contact exists for the account | 2 | Engineering |

The "born-referred race" in the third row is the most counterintuitive: the sync creates the company *with* the referrer field already set and associates the contact afterwards, and the CRM re-evaluates enrollment only on property changes, never on association creation. So the ideal case, a fresh organic referral, systematically missed, while late manual attributions enrolled. The fix is a scheduled daily enrollment sweep with a "path is unknown" guard, after a one-time legacy stamp of the pre-launch population.

An earlier theory, that the sync was creating duplicate companies, turned out to be wrong: one company per product group id, exactly as designed. Writing down the wrong theory and why it was wrong is part of the audit document.

## Outcome

The workflow went live August 18, 2026 and had routed 143 referred contacts by the end of September. The audit produced an engineering backfill request with exact counts and join keys, and the scheduled-trigger redesign. The routing-path stamps make every future comparison of outreach paths a one-line report, with the stated caveat that cross-path comparisons measure segment quality, not treatment effect.
