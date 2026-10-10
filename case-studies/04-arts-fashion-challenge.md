# Arts & Fashion Challenge

**Role:** product owner, architect, builder. **Shipped:** four PRs between September 24 and 28, 2026, with a rules change on September 29. **Stack:** same as the community site, plus HubSpot custom-object search and Inngest.

## The problem

Posh was running a two-month referral competition for a cohort of roughly 225 affiliates in the arts and fashion vertical: cash prizes for the most referrals won. The competition had already started a week earlier. The cohort needed a home base: standings, a countdown, rules, a US map of wins, and a way to talk to each other.

The obvious move was to fork the existing community site. The constraint was that the live site could not change by one byte: thousands of people used it, and a $1,000 leaderboard must not be affected by a bug in a page it does not share.

## Architecture decision: parametrize reads, isolate writes

I evaluated three bases (the public landing-page system, an internal enablement room, and the community site) and chose the community site because it was the only one with strict Zod payloads, the GMV tripwire, a rotatable password gate, and the components.

The rule I set for the build:

- **Reads are parametrized by page id.** Cookie helpers, auth, snapshot lookup, and the Hono routes all take a `pageId`; the default id is byte-identical to the old behavior and a check script proves it.
- **Writes are isolated.** The cohort gets its own tables (snapshots, roster, referral flags), its own config row, its own cookie name and HMAC prefix, its own cache key, its own rate-limit action, and its own sub-router whose slug is validated against an allow-list before any database touch.

Why the paranoia about a shared snapshot table: the live reader takes the newest row *table-wide* and returns null on a strict-parse miss. One cohort row in a shared table would blank the live site on rollback.

## Cohort definition

HubSpot had no single property marking the cohort. The rule became: an affiliate is in the cohort if **either** their routing vertical is "Arts & Fashion" **or** their onboarding source is the campaign link. Three members had no vertical at all because their organization had none; that gap is why the OR exists. In HubSpot's search API, that is two filter groups (groups are ORed, filters inside a group are ANDed), and the snapshot records which marker matched.

The roster sync is add-only and admin-button-only, never run inside a refresh. A leaderboard with cash prizes must not move because a tag drifted overnight.

## The four PRs

| PR | Scope | Notable |
|----|-------|---------|
| 1 | Foundations, zero behavior change | Also closed a live hole: an unauthenticated refresh endpoint reachable from preview deployments that shared the production database |
| 2 | Home base: gate, hero + countdown, standings, rules, roster tab, daily Inngest build | Standings comparator, competition ranking, a 13-assertion check script including a static grep for forbidden fields |
| 3 | Community layer: cohort map, connect, phone-verified chat, progress tiles, staff cost card | Cost card reachable only via lazy import so the public bundle cannot include it |
| 4 | Hardening, sunset logic, staff CSV exports | Winners callout with tie note, composers close at the deadline with a server-side 410, injection-safe CSV quoting |

PR 1 was deployed and verified before PR 2 merged. PR branches were named so the hosting platform skipped preview deployments entirely.

## Decisions I had to extract from the business owner

Eighteen open questions went into the brief before any code. The ones that changed the build:

- No data source says whether a *referred* organization is arts and fashion. Decision: count every referral by a roster member by default, and give staff a Qualification tab to exclude individual referrals with a note.
- Points. First: won (org created) 1 point, activated (first paid order) 2 points. After the first live week the owner changed it to wins only, deadline extended two months. The ranking is a pure function of the snapshot, so the rule change was one comparator and a copy pass.
- No commission shown anywhere on the public page. Monthly boards dropped.
- Chat is a one-way bulletin open to all roster members, phone-verified, with an auto-approve toggle.

## What review caught

The build used large attack-first review workflows (the biggest was 113 agents across adversarial reviewers, refuters, a spec designer, implementers, and a final verifier). Confirmed findings included a page-global cap on blocked-chat Slack alerts so a bot could not flood the channel, a duplicate-pending check on the verified phone digits, never caching an empty eligibility set, and UUID guards on admin routes. One finding came from a sibling session: a `jsonb_build_object` bare parameter in the roster re-key, the same Postgres pitfall as the lifecycle engine, now caught by a static grep in the check script.

## Outcome

The owner ran the first live build the night PR 2 merged: 225 synced, 3 won, 1 activated. One fix followed from watching real usage: with competition ranking, 223 people at zero were "tied for 3rd," so standings now show only members with at least one win. Launch calls to the cohort happened the following week with all four PRs live.
