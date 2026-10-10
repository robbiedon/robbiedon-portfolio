# Operations Automation

Smaller pieces, each chosen for being the least amount of machinery that solved the problem.

## Weekly webinar automation (Google Apps Script)

**Built:** August 3, 2026.

The affiliate program runs a weekly kickoff webinar. RSVPs flow from the product into a CRM custom object. Someone had to add each week's RSVPs to the calendar invite and send individual reminders.

A Google Apps Script with two time-based triggers does it: Monday morning it reads the week's RSVPs from the CRM custom object via REST (matching on event name and that day's date bounds in Eastern time, then following associations to contact emails) and adds them to the recurring calendar event, deduplicated. Wednesday afternoon it adds any late RSVPs and sends one-to-one reminder emails.

Why Apps Script and not a scheduled agent or a serverless function: it runs on Google's servers with Google's auth, independent of any laptop, with no new infrastructure and no connector availability risk. The CRM token lives in Script Properties. The day-after follow-up was deliberately left to a CRM workflow where it belongs.

## Account-executive territory sheet (12k CRM records to 20 tabs)

**Built:** October 9, 2026, four versions in one day.

Five account executives were starting a sprint to activate affiliates in fifteen cities. They needed, per city and per AE, the list of affiliates with contact info, referral revenue, and referral counts, sorted so the already-assigned and already-referring people float to the top.

The CRM search API caps at 10,000 results per query and the affiliate object had 12,141 records, so the pull was split by object-id ranges and fanned out across parallel agents, with contacts joined on the product account id in batches of 100. City assignment came from two free-text fields (a comma list of markets and a free-form "network cities" field) with explicit matching rules printed on the sheet: a two-letter token after a comma in a two-part "City, ST" string is a state, in a three-plus market list it is a city; "Washington" alone is DC unless followed by "state" or "heights."

The result was built as an .xlsx with openpyxl and imported into Google Sheets in place so the share link never changed. The General tab's counts are `COUNTA` formulas over the city tabs, so they stay correct if someone edits a row. The headline number the sprint was organized around: of 4,335 affiliates in those fifteen cities, 4,177 had no partnerships owner.

Verification: a three-lens workflow recounted from the xlsx, checked the formula semantics, and spot-checked 21 rows against the live CRM. Zero mismatches.

## Inbox migration to an AI support agent (Intercom Fin)

**Started:** August 5, 2026.

The affiliate program's support inbox moved to Intercom with Fin, Intercom's AI agent, handling common questions. The work was mostly taxonomy: a two-level attribute scheme (family and subtopic) covering onboarding, referrals, payouts, organizer handoff, and escalation; eleven Fin article drafts in a scenario / how-to-respond / note-structure format; and four playbook snippets keyed to the subject lines of the four welcome-journey emails so that replies to any of them get the right context.

The one rule I would carry to any similar migration: write down the words you must never use. In this program, the word "kickback" refers to a different product feature, and an AI agent that learned it from a stray macro would have confused every affiliate it talked to.

## Market intelligence reports

Per-city research reports for new-market launches: top organizers by revenue flagged as already-affiliate versus recruit, a hand-researched Instagram lead list of 65 to 100 rows with confidence and suggested intro path, and a market section covering demographics, platform landscape, risks, and a sales battlecard. Eight cities as of October 2026, with a repeatable format and a documented CRM query for the organizer hit list.
