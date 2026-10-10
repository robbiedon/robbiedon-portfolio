# Affiliate Community Site

**Role:** product owner, builder, security reviewer. **Shipped:** four phases over August 7 to 12, 2026, with a design pass in September. **Stack:** TypeScript, Hono, React 19, Tailwind, Neon Postgres, MongoDB (read-only), us-atlas map data, Slack.

## The problem

Affiliates asked for two things the program could not give them: visibility into how they ranked, and a way to find other affiliates in their city to collaborate with. The program's value proposition was networking, and there was no place to network.

The hard constraint: the site is public-facing to thousands of people who are paid a percentage of Posh's fee. Showing commission is fine. Showing GMV next to commission would let any affiliate compute the fee percentage, which is confidential. So the payload had to be *structurally* incapable of carrying GMV, not just "we don't display it."

## What I built

A password-gated public site at `/affiliates` with four sections, each individually toggleable by staff:

1. **Leaderboards.** Monthly commission and referral top-10s from a daily snapshot. Names shown as "First L." plus Instagram handle.
2. **US map.** Projected city dots over state paths, with per-city rosters. Regenerated from a script so the city key list stays in sync with the geo lookup.
3. **Get Connected.** An affiliate picks a city, sees who is active there, can flag up to three people, and submits a request. A staff member brokers the intro. Requests land in Slack and in an admin inbox.
4. **Bulletin.** A moderated board where top-10 affiliates can post. Pending until approved; a live post can be pulled in under five minutes.

### Data-leak defenses

- The snapshot builder never `SELECT`s GMV or fee columns.
- The public payload is parsed with a strict Zod schema that rejects unknown keys.
- A regex tripwire scans every outgoing payload for `gmv|fee|percent|take|cost` and fails the build if it matches.
- A CI check script imports the pure payload module with the database URL deleted from the environment, proving nothing in that path can touch the DB.

### Authentication

Shared password, scrypt-hashed, rotatable from the staff editor. The cookie embeds a password generation number, so rotating the password logs everyone out instantly. Login is rate-limited per IP with a global ceiling.

### Phone-verified posting

Bulletin posts first identified posters by Instagram handle, which anyone could type. Phase 4 moved to phone verification: the snapshot stores a server-only HMAC-hashed set of each eligible affiliate's phone numbers (pulled from the product database), and a post must match both the name and a submitted phone hash. One uniform 403 for every failure mode so the endpoint cannot be used as an oracle.

## What review caught

Every phase went through an adversarial review before it went public. Across the four phases and the phone gate, reviewers found 25 real defects, including:

- **Generation-cache lockout.** A rotated password plus a cached old generation locked everyone out until the cache expired.
- **Two TOCTOU rate limits.** Check-then-increment let a concurrent burst past the limit. Fixed as record-then-verify.
- **Cross-month ranking bug.** A `GREATEST()` over two months ranked people by their better month rather than the current one.
- **Surrogate-pair JSON poison.** A lone UTF-16 surrogate in a post body broke the jsonb column write.
- **Slack injection.** A post containing `<!channel>` would have paged the whole channel.
- **Phone brute-force oracle.** The gate throttle was check-then-record, so a concurrent burst could probe phone numbers.
- **Name-key collision pooling phones.** Two affiliates with the same normalized name shared one phone pool. Now fails closed.
- **Unset HMAC secret failed open.** Now fails closed.
- **A Mongo projection path collision** (`phone` and `phone.number` in the same projection) silently returned no phones for anyone.

I treat that list as the single best argument for always running adversarial review on any new public or gated surface. It found real bugs every single time.

## Design pass (September)

The staff-side dashboard section for this program had grown "all white." I established a small design language and applied it across six cards: grey 3%-opacity stat tiles on white cards, bold display numbers, mono uppercase section labels, and a `CollapsibleCard` banner pattern where each card's headline metrics live on the collapsed banner.

One review lesson from that pass is worth recording: the first version of the collapsible rendered `{open && children}`, which *unmounts* the body on collapse. A full-width banner became a one-click accidental discard of a half-filled form, and re-expanding spawned a second background loop. Always hide, never conditionally render, bodies that hold in-progress state.

## Outcome

The site has been live since August 2026. The Slack channel receives intro requests, blocked-post alerts, and daily program digests. The phone-verified bulletin shipped with the staff member's own number allow-listed so they could post announcements through the same gate. The codebase became the foundation for the cohort-scoped challenge site in case study 4.
