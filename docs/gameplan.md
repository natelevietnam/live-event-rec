# Worth It — build spec (revised)

TrashLab take-home. **Status: built and deployed** —
https://natelevietnam.github.io/live-event-rec/

Revised from the original gameplan on Aug 20. Two of the changes below were scope decisions (the
build moved a day earlier, the Google Calendar integration was cut). The rest came from measuring
the live API rather than trusting the spec — each one is listed with the measurement that forced it.

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
| 7 | **`geoPoint` leads instead of `dmaId=382`.** | Step 0 against the live API showed `dmaId=382` returns Sacramento venues — roughly 90 miles from SoMa, scored identically to Mountain View by the city buckets. The 50-mile `geoPoint` constrains this server-side. A client-side distance guard covers the fallback path. |
| 8 | **Urgency rebuilt on two axes.** | Measured on live data, the spec's onsale rule was a constant: 0 of 200 sampled events had a future public onsale. Every show scored 8, so urgency contributed nothing and five shows tied at 68 for three slots. Proximity to the show date carries the same scarcity insight on a signal the data actually has. The onsale rule survives as an override. |
| 9 | **A missing price is no longer scored.** | 70% of events publish no price, so the flat 7/15 went to most of the list and flattened it. Those events are now scored out of 85 and the card says so. Normalizing to 0–100 keeps the two denominators comparable. |
| 10 | **Taste is weighted by match confidence.** | A seed matched exactly is a more certain read than one matched inside a longer billing, and now scores 45 against 40. Co-headliners hitting several seeds are named in the reason rather than one being picked arbitrarily. |
| 11 | **Tribute and covers acts are cut.** | They carry the real artist's name and match cleanly, so a tribute band would have been presented as the artist — the exact invented fact principle 3 forbids. Two seeds on Nate's list (Pop Smoke, Michael Jackson) are deceased, so tributes are the only thing they can surface. |

| 12 | **"Get tickets" link on every card.** | The Discovery payload already carries the official Ticketmaster listing URL, present on 6 of 6 shortlisted shows. No reseller scrape is involved and the destination is the primary seller. |
| 13 | **Price ceiling raised to $300.** | Nate's call. It changed nothing in the current output, which is itself the finding — see the price coverage note below. |
| 14 | **Refresh button, two modes.** | A static public page cannot hold an API key, so the browser can never query Ticketmaster directly. Live refresh runs locally via a dev server that holds the key; the deployed page refreshes against data rebuilt twice daily by a scheduled GitHub Action. Both modes state which one they are performing. |

Everything else follows the original spec literally.

### Why prices are missing, measured

Across 600 sampled events, only 30% publish a `priceRanges` block at all, and the gap is worst
exactly where it hurts:

| Venue type | Events with a published price |
|---|---|
| Stadiums, arenas, amphitheatres, pavilions | **1 of 58 — 2%** |
| Everything smaller | 176 of 542 — 32% |

Arena acts are precisely what is on the seed list, which is why all six shortlisted shows read "No
price published" and why raising the ceiling from $200 to $300 changed nothing. Confirmed not to be
a fetch bug: the single-event detail endpoint returns no `priceRanges` either, and only `standard`
price types ever appear — never resale.

**Every route to real prices requires a partnership, not a signup.** All were checked:

| Route | Gives | Status |
|---|---|---|
| Ticketmaster **Commerce API** | Real offers and price levels | **Partner only.** Verified `401 InvalidApiKeyForGivenResource`. Restricted to "a select few business partners"; contact `partnersupport@ticketmaster.com`. |
| Ticketmaster **Inventory Status API** | Sold-out / limited — a real scarcity signal | **Partner only.** Same 401. |
| **SeatGeek Platform API** | `lowest_price` / `average_price`, resale included | **Application only.** `portal.seatgeek.com` gates access behind a "Get Access" form and manual approval; there is no self-serve `client_id` flow. |
| Ticketmaster **Affiliate Program** (Impact) | Affiliate links across TM, TicketWeb, Universe, Front Gate, Moshtix | **Application, approval required.** Expanded price data is not a stated benefit. |
| Scraping StubHub / Vivid | Prices | **Rejected.** Breaks their terms, selectors rot, and unverifiable prices would undermine the one thing this product sells — that every number traces to a source. |

The realistic near-term path is the **Ticketmaster Affiliate Program**: the only one with an open
application form, and the only one that would also let the "Get tickets" links earn anything.

---

## 1. What this is

You give it the artists you would actually go see. It returns a short ranked list of shows in the Bay
Area worth your money in the next 90 days, each with a reason, plus a visible list of what it
rejected and why.

**Positioning:** Bandsintown tells you an artist you follow is playing. It cannot tell you whether to
go. This decides.

**The insight:** the thing that flips a maybe into a yes is rarely the artist. It is scarcity and
friction. The show is in nine days. It is a Wednesday in Mountain View and you have a 9am. No
existing tool weighs those together.

The original framing of scarcity was "onsale closes Thursday". The live data says otherwise — at 90
days out essentially everything is already on sale — so the scarcity that actually bites is how soon
the show is. Same insight, measured signal. See change 8.

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

- `config/artists.json` — **57 names supplied by Nate.** More than the 20–30 originally planned; the
  effect is simply that more of the window matches and the cut list does more work.
- `config/similar-artists.json` — **192 adjacent artists**, generated once offline across the 57 seeds.
- `config/prefs.json` — home, `priceCeiling`, `weeknightTolerance`, `horizonDays`.
- `.env` — `TICKETMASTER_API_KEY`, supplied and gitignored. Build-time only; it never reaches the
  browser or the host.

---

## 4. Data source

Ticketmaster Discovery API v2, `GET /discovery/v2/events.json`.

Params: `apikey`, `classificationName=music`, locality, `startDateTime` = now,
`endDateTime` = now + 90 days, `size=200`, `page` paginated, `sort=date,asc`.

Locality strategies, tried in order until one returns events:
`geoPoint=9q8y&radius=50&unit=miles` → `dmaId=382` → `city=San Francisco`.
See change 7 above for why `geoPoint` leads rather than `dmaId`.

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

Containment matching requires 2+ tokens **and 6+ characters**, so short names cannot match inside
unrelated titles — `Future` does not match Future Islands, and `T.I.` (normalized `t i`) does not
match any title with those letters as adjacent words. Tribute and covers acts are cut with "tribute
or covers act, not the artist"; see changes 10 and 11 above. Everything matching neither tier is cut
with "no taste match".

---

## 6. Scoring (0 to 100)

Weights live in one config object so the UI can render the breakdown.

| Component | Max | Rule |
|---|---|---|
| Taste | 45 | Direct 45, or 40 if matched inside a longer billing. Adjacent 20, or 17 the same way. |
| Urgency | 20 | Higher of two axes. Onsale: opens ≤7d 20, ≤30d 12, later 5, on sale now 4, unknown 4. Proximity: show ≤14d 18, ≤30d 12, ≤60d 7, beyond 3. |
| Effort | 20 | SF 20. Near East Bay 14. Peninsula/South Bay 8. Minus 6 if Mon–Thu. Floor 0. |
| Price | 15 | Min at or under 40% of the $300 ceiling: 15. Under ceiling: 10. Over: 0. **Not published: not scored**, event ranked out of 85. |

Scores are normalized to 0–100 so an 85-denominator show stays comparable to a 100-denominator
one. Both answer the same question: what fraction of the points this event could have earned did
it earn.

Reason strings assemble only the components that fired, and only the urgency axis that actually
set the score:

> Direct match: Usher, Chris Brown. 8 days out. Santa Clara venue, Friday. No price published.

No adjectives, no LLM, no invention. "On sale now" earns no clause — it was true of every event in
the window, so it says nothing about whether to go.

### What the live data forced

Both changes to the spec's scoring came from measuring, not from taste:

| Finding | Measurement | Consequence |
|---|---|---|
| Onsale urgency is a constant | 0 of 200 sampled events had a future public onsale; 1 had a future presale | Every show scored 8/20. Five tied at 68 for three slots. Rebuilt on proximity. |
| Most events have no price | 141 of 200 (70%) carry no `priceRanges`; big rooms are worst | Flat 7/15 went to most of the list. Now excluded from the denominator instead. |

Before the fix every shortlisted show scored exactly `60 + effort` — the ranking was sorting by
venue distance and nothing else. After it, the top six span 71–91 and the matched population
spans 31–91.

---

## 7. Output

A Node script fetches, matches, scores, and writes `public/data.json` with a `generatedAt` timestamp.
A single static HTML page renders that file. No API key reaches the browser.

Page structure, top to bottom:

1. **Header.** "N shows worth your time in the next 90 days." Last refreshed timestamp, visible.
2. **The list.** 3 to 6 cards: artist, date and day of week, venue and city, price from, score, the
   reason sentence, urgency badge. Score breakdown expandable, with a per-component bar and a
   plain-language note. A "Get tickets" link goes to the official Ticketmaster listing.
3. **"Filtered out (N)."** Collapsed by default. One line each: artist, date, reason.
4. **Footer.** Source, locality strategy used, events considered, paging truncation if any, and the
   coverage gap stated plainly: big rooms are covered, indie venues on DICE and Eventbrite are not.

Visual bar: one accent color, generous whitespace, real type hierarchy, works on a phone. No gradient
hero, no emoji, no stock imagery. Dark, committed to.

---

## 8. Deploy

**Live: https://natelevietnam.github.io/live-event-rec/**

GitHub Pages, served from the `gh-pages` branch which holds the contents of `public/`. Refresh with
`npm run build:data`, commit, then `npm run deploy`. No build command on the host — `data.json` is
generated locally and committed, so the key never touches the host.

Verified in a clean incognito profile against the live URL: renders correctly, and no horizontal
overflow at 360, 400, 480, or desktop widths.

`npm run bundle` also writes `dist/worth-it.html`, one self-contained file that opens by
double-click and works offline — a shareable artifact that needs no host or account.

---

## 9. Revised timebox for Friday

| Time | Work |
|---|---|
| 10:00–10:30 | API key in `.env`, artist list finalized, `npm run verify` passes |
| 10:30–11:00 | `npm run build:data`, read the real output, sanity-check matches and cut reasons |
| 11:00–12:00 | Tune: adjacent-artist map, weights if the ranking looks wrong, copy |
| 12:00–13:00 | Redeploy (npm run deploy), incognito check |
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

## 11. Status

- [x] `config/artists.json` — 57 names supplied by Nate
- [x] `config/similar-artists.json` — 192 adjacent artists generated offline
- [x] Ticketmaster API key in `.env` (gitignored)
- [x] Step 0 verified against the live API
- [x] Real `public/data.json` generated — 1000 events read, 6 shortlisted, 994 cut
- [x] Page verified rendering in headless Chrome
- [x] Single-file build (`npm run bundle` → `dist/worth-it.html`), verified under `file://`
- [x] Deployed — https://natelevietnam.github.io/live-event-rec/
- [ ] Confirm price ceiling (200) and weeknight tolerance (low)
- [ ] Press release, roadmap write-up, demo video

Two seeds on the list cannot tour: **Pop Smoke** and **Michael Jackson** are deceased, so those
entries can only surface tribute acts, which the tribute guard cuts. They are harmless but
contribute nothing.
