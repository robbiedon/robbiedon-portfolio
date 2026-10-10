# Robert Dong — Portfolio

I lead the affiliate community program at Posh, a ticketing and event platform. Over summer and fall 2026 I also became the person who builds the internal software that runs that program: 100+ merged pull requests into Posh's production monorepo, shipping a lifecycle engine, a public community site, two incentive-program trackers, a CRM routing system, and a lead-gifting pipeline that pays for itself.

The production code is Posh's and lives in a private repository. This repo is the public record of that work:

- **Case studies** describing each system: the problem, the architecture, the hard decisions, and what happened after launch.
- **Three small open-source utilities** extracted (with permission) from patterns that proved themselves in production.

## How I work

I am not a traditionally trained engineer. I built everything here using AI-assisted development (Claude Code) as a pair programmer, and I own the parts that matter: deciding what to build, writing the specs, designing the data model, running adversarial reviews before anything ships, operating the systems in production, and fixing them when they break at 2pm on a Tuesday. Every case study notes what the review process caught, because that is where most of the real engineering happened.

## Stack

TypeScript end to end. Hono API routes on Vercel serverless, React 19 + Tailwind on the front end, Neon Postgres via Drizzle and the neon-http driver, Inngest for durable cron and event-driven jobs, MongoDB (product database, read-only), Redshift via Lightdash's SQL runner (warehouse), HubSpot CRM API, Iterable (messaging), Slack webhooks. Google Apps Script and HubSpot workflows where no code was the right amount of code.

## Case studies

| # | System | One line |
|---|--------|----------|
| 1 | [Affiliate Lifecycle Engine](case-studies/01-affiliate-lifecycle-engine.md) | Daily state-diff over warehouse + CRM data that turns silent affiliate behavior into a durable event log, Slack digests, and exactly-once Iterable sends |
| 2 | [Lead Gift Engine](case-studies/02-lead-gift-engine.md) | Event-triggered Instagram lead scraping with hard budget rails, review queues, and a ROI readout. First end-to-end gift delivered 12 days after kickoff |
| 3 | [Affiliate Community Site](case-studies/03-affiliate-community-site.md) | Password-gated public site with leaderboards, a US map, intro requests, and a phone-verified bulletin. Four phases, every one adversarially reviewed |
| 4 | [Arts & Fashion Challenge](case-studies/04-arts-fashion-challenge.md) | A cohort-scoped fork of the community site for a two-month referral competition, built in four PRs in four days without touching the live page |
| 5 | [Referral Bounty Tracker](case-studies/05-referral-bounty-tracker.md) | Staff dashboard for a seasonal promo: live GMV from the product DB, promo cost, and an atomic round-robin that assigns intros to account executives |
| 6 | [Post-Event Flows](case-studies/06-post-event-flows.md) | Ported a multi-step spreadsheet workflow into a deterministic pipeline with 62 scenario tests and a documented list of past bugs it must never repeat |
| 7 | [Referred-Org Routing in HubSpot](case-studies/07-hubspot-referral-routing.md) | A first-match-wins routing waterfall built as CRM workflows, plus the 30-day outcome check that measures it and the data-model audit that found why 27% of referrals were missed |
| 8 | [Operations Automation](case-studies/08-ops-automation.md) | The smaller things: webinar automation in Apps Script, a 20-tab territory sheet built from 12k CRM records, and an inbox migration to an AI support agent |

## Open-source utilities

| Package | What it does |
|---------|--------------|
| [`hubspot-paginate`](packages/hubspot-paginate) | Pull every record from a HubSpot CRM search, past the 10,000-result ceiling, with tie-safe window restarts, 429 backoff, and multi-token fallback |
| [`neon-jsonb-guard`](packages/neon-jsonb-guard) | A static check that catches a Postgres runtime error TypeScript cannot: bound parameters inside `jsonb_build_object` without a cast |
| [`atomic-round-robin`](packages/atomic-round-robin) | Round-robin assignment with a derived pointer and id-pinned undo, in one SQL statement, for drivers with no transactions |

Each package is dependency-free TypeScript with tests that run on plain `node --test`.

## Contact

GitHub: [@robbiedon](https://github.com/robbiedon)
