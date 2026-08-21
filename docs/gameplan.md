# Worth It — build spec (revised)

TrashLab take-home. Revised from the original gameplan on Aug 20 to reflect two scope decisions:
the build moved a day earlier, and the Google Calendar integration was cut.

Hard freeze Friday Aug 21, 14:00 PT.

---

## Changes from the original gameplan

| # | Change | Why |
|---|---|---|
| 1 | **Calendar integration cut entirely.** Section 7 is gone. The "Worth it, but you are busy" bucket is gone from the page. | It was flagged in the original as a nice-to-have with a 30-minute kill switch, not the loop. Cutting it up front buys the whole Friday window for the ranked list and the cut list, which are the product. It moves to the roadmap, named honestly. |
| 2 | **Calendar privacy rule dropped.** | Moot once there is no calendar read. Nothing on the deployed page touches Nate's calendar, so there is nothing to redact and the shared link carries no personal data at all — a cleaner story than a redaction rule. |
| 3 | **Built Thursday evening, not Friday morning.** | Fetch, match, score, and page were written ahead of the window. Friday is now key + artist list + verification + real data + deploy, which turns a four-hour build into a four-hour buffer. |
| 4 | **One card per artist (new).** | A three-night run is one decision, not three. Without this the top six can be one act six times. Extra nights go to the cut list with a stated reason — never silently dropped. |
| 5 | **Locality fallback is automatic (new).** | The original said "verify `dmaId=382`, fallback if it fails." The build script now tries all three strategies in order and states which one it used, in the footer. A silent geography failure is the worst failure mode here. |
| 6 | **Paging ceiling disclosed (new).** | Discovery refuses paging past 1000 items. If the window has more, the footer says how many of how many were read. Silent truncation would read as "we looked at everything." |

Everything else follows the original spec literally.

---

## 1. What this is

You give it the artists you would actually go see. It returns a short ranked list of shows in the Bay
Area worth your money in the next 90 days, each with a reason, plus a visible list of what it
rejected and why.

**Positioning:** Bandsintown tells you an artist you follow is playing. It cannot tell you whether to
go. This decides.

**The insight:** the thing that flips a maybe into a yes is rarely the artist. It is scarcity and
friction. Onsale closes Thursday. It is a Wednesday in Mountain View and you have a 9am. No existing
tool weighs those together.

---

## 2. Non-negotiable design principles

1. **No runtime LLM.** Every reason string is generated from the actual scoring inputs, so the
   product structurally cannot hallucinate a reason. Say this out loud in the video.
2. **Show the cut.** The rejected shows are visible with their reasons.
3. **No invented facts.** If a signal is not in the data it does not appear in the UI. It goes in the
   roadmap instead.
4. **No accounts, no auth, no login, no database.** Static build output.
5. **Ship the loop, not the breadth.**

---

## 3. Inputs

- `config/artists.json` — 20 to 30 artist names Nate would actually go see. **Still open.**
- `config/prefs.json` — home, `priceCeiling`, `weeknightTolerance`, `horizonDays`.
- `.env` — `TICKETMASTER_API_KEY`. Free key from developer.ticketmaster.com. **Still open.**

---

## 4. Data source

Ticketmaster Discovery API v2, `GET /discovery/v2/events.json`.

Params: `apikey`, `classificationName=music`, locality, `startDateTime` = now,
`endDateTime` = now + 90 days, `size=200`, `page` paginated, `sort=date,asc`.

Locality strategies, tried in order until one returns events:
`dmaId=382` → `geoPoint=9q8y&radius=50&unit=miles` → `city=San Francisco`.

Fields extracted per event: `name`, `dates.start.dateTime` / `.localDate`, `dates.status.code`
(cancelled and postponed are cut), `sales.public.startDateTime`, `sales.presales[]`,
`_embedded.venues[0]` name / city / lat / lon, `priceRanges[0].min` and `.max` (often absent — handled
as missing, never guessed), `_embedded.attractions[].name`.

**Step 0 before anything else:** `npm run verify` prints the raw count and five event names per
strategy. If Bay Area music events do not come back, stop and fix the query. Do not build on an
unverified source.

---

## 5. Matching

**Tier 1, direct.** Normalized match of attractions against `artists.json`. Case-insensitive,
punctuation stripped, leading "The" dropped.

**Tier 2, adjacent.** `config/similar-artists.json`, generated once offline at build time, maps each
seed to 3–6 adjacent artists. Adjacent matches score lower and are labelled "adjacent to &lt;seed&gt;",
never presented as direct.

Containment matching requires 2+ tokens so short names cannot match inside unrelated titles.
Everything matching neither tier is cut with "no taste match".

---

## 6. Scoring (0 to 100)

Weights live in one config object so the UI can render the breakdown.

| Component | Max | Rule |
|---|---|---|
| Taste | 45 | Direct 45. Adjacent 20. |
| Urgency | 20 | Opens within 7 days: 20. Within 30 days: 12. Already on sale: 8. Unknown: 5. |
| Effort | 20 | SF 20. Oakland/Berkeley 14. Peninsula/South Bay 8. Minus 6 if Mon–Thu. Floor 0. |
| Price | 15 | Min at or under 40% of ceiling: 15. Under ceiling: 10. Over: 0. Missing: 7, labelled "price TBD". |

Reason strings assemble only the components that fired:

> Direct match. Presale opens Tue Aug 25. SF venue, Saturday. From $68.

No adjectives, no LLM, no invention.

---

## 7. Output

A Node script fetches, matches, scores, and writes `public/data.json` with a `generatedAt` timestamp.
A single static HTML page renders that file. No API key reaches the browser.

Page structure, top to bottom:

1. **Header.** "N shows worth your time in the next 90 days." Last refreshed timestamp, visible.
2. **The list.** 3 to 6 cards: artist, date and day of week, venue and city, price from, score, the
   reason sentence, urgency badge when onsale is inside 7 days. Score breakdown expandable.
3. **"Filtered out (N)."** Collapsed by default. One line each: artist, date, reason.
4. **Footer.** Source, locality strategy used, events considered, paging truncation if any, and the
   coverage gap stated plainly: big rooms are covered, indie venues on DICE and Eventbrite are not.

Visual bar: one accent color, generous whitespace, real type hierarchy, works on a phone. No gradient
hero, no emoji, no stock imagery. Dark, committed to.

---

## 8. Deploy

Vercel, static output from `public/`. No build command on the host — `data.json` is generated locally
and committed, so the key never touches Vercel. Confirm the link opens clean in incognito before
sending.

---

## 9. Revised timebox for Friday

| Time | Work |
|---|---|
| 10:00–10:30 | API key in `.env`, artist list finalized, `npm run verify` passes |
| 10:30–11:00 | `npm run build:data`, read the real output, sanity-check matches and cut reasons |
| 11:00–12:00 | Tune: adjacent-artist map, weights if the ranking looks wrong, copy |
| 12:00–13:00 | Deploy to Vercel, incognito check |
| 13:00–14:00 | Buffer |
| **14:00** | **FREEZE.** |
| 14:00–15:30 | Press release and roadmap |
| 15:30–16:30 | Record the video, 2 or 3 takes |
| 16:30–17:30 | Buffer, then send |

---

## 10. Roadmap (the cuts, named honestly)

1. **Source coverage.** Ticketmaster misses indie venues. Add DICE and Eventbrite. This is the
   difference between a tool for arena shows and a tool for going out in SF.
2. **Rarity signal.** "First Bay Area date in two years" is the strongest yes-flipper and is
   deliberately absent, because the Discovery API carries no tour history and guessing it would mean
   inventing a fact. Needs a tour-history source.
3. **Calendar conflicts.** A show overlapping a busy block should move to its own bucket rather than
   rank as if the night were free. Cut for scope on the day, not for lack of value.
4. **Group coordination.** The real blocker on a maybe is often whether a friend is in. A share link
   with a one-tap yes.

---

## 11. Open items for Nate

- [ ] `config/artists.json`, 20 to 30 names
- [ ] Ticketmaster API key into `.env`
- [ ] Confirm price ceiling (200) and weeknight tolerance (low)
- [ ] Confirm Vercel as the host
- [ ] Repo `natelevietnam/live-event-rec` is currently public — confirm that is intended
