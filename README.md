# Live Event Rec

**Live: https://natelevietnam.github.io/live-event-rec/**

You give it the artists you would actually go see. It returns a short ranked list of Bay Area shows
worth your money in the next 90 days — each with a reason — plus a visible list of what it rejected
and why.

Bandsintown tells you an artist you follow is playing. It cannot tell you whether to go. This decides.

**The insight:** the thing that flips a maybe into a yes is rarely the artist. It is scarcity and
friction. The show is in nine days. It is a Wednesday in Mountain View and you have a 9am. No
existing tool weighs those together, so you decide from a flat feed of forty equally-weighted rows.

---

## Design principles

These are load-bearing, not decoration.

1. **No runtime LLM.** Every reason string is assembled in `src/reason.mjs` from the actual scoring
   inputs. The product structurally cannot hallucinate a reason for a show.
2. **Show the cut.** Rejected shows are listed with their reasons. Showing your work on what was
   filtered out is the credibility of a ranking product.
3. **No invented facts.** If a signal is not in the source data it does not appear in the UI. Missing
   prices read "No price published", are never estimated, and are not scored at all.
4. **No accounts, no auth, no login, no database.** Static build output.
5. **Ship the loop, not the breadth.** One clean end-to-end pass beats three half-features.

---

## Running it

```bash
cp .env.example .env          # paste a free key from developer.ticketmaster.com
$EDITOR config/artists.json   # the artists you would actually go see

npm run verify                # Step 0 — proves the query returns real Bay Area events
npm run build:data            # fetch, match, score, write public/data.json
npm run dev                   # serve the page WITH a working live Refresh button
```

No install step: there are no runtime dependencies. Node 20+ only.

`npm run verify` runs before anything is trusted downstream. It prints the raw event count and five
event names for each locality strategy, so a broken query fails loudly instead of quietly producing
an empty list.

---

## How it works

`scripts/build-data.mjs` is the whole pipeline. It fetches, matches, scores, and writes
`public/data.json`. `public/index.html` renders that file and nothing else. **The API key is used
only at build time and never reaches the browser.**

### Source

Ticketmaster Discovery API v2, `classificationName=music`, sorted by date, paginated to the API's
ceiling. Three locality strategies are tried in order and the first one returning events wins:

| Order | Strategy |
|---|---|
| 1 | `geoPoint=9q8y` with `radius=50&unit=miles` |
| 2 | `dmaId=382` — San Francisco / Oakland / San Jose |
| 3 | `city=San Francisco` |

Which one was actually used is printed at build time and stated in the page footer.

`geoPoint` leads rather than `dmaId` because Step 0 caught `dmaId=382` returning Sacramento venues —
Ace of Spades, Crest Theater — roughly 90 miles from SoMa, which the effort buckets would have scored
identically to Mountain View. The 50-mile radius constrains this server-side, and a client-side
distance guard (60 miles, from the lat/long the API already returns) covers the fallback path.

### Matching

**Tier 1, direct.** Normalized match of `_embedded.attractions[].name` against `config/artists.json` —
case-insensitive, punctuation stripped, leading "The" dropped.

**Tier 2, adjacent.** `config/similar-artists.json` maps each seed artist to 3–6 adjacent artists.
It is generated once, offline, at build time; it is never fetched at runtime. An event matching only
an adjacent name scores lower and is labelled "adjacent to &lt;seed&gt;" in the UI. It is never
presented as a direct match.

Two guards keep the list trustworthy:

- **Containment floors.** Matching a seed as a phrase inside a longer title requires 2+ tokens *and*
  6+ characters. Without the character floor "T.I." (normalized: `t i`) would match any title with
  those two letters as adjacent words. Short names still match, but only exactly — so `Future`
  matches Future and not Future Islands, and `XG` matches XG and not "XG Racing Night".
- **Tribute guard.** Tribute and covers acts carry the real artist's name, so they match cleanly and
  would be presented as the artist. They are cut with "tribute or covers act, not the artist".
  Known limitation: this catches acts that say so in their name; an "MJ Live" style tribute that
  never spells it out still slips through.

Everything matching neither tier is cut with "no taste match".

### Scoring, 0–100

Weights live in one object (`WEIGHTS` in `src/score.mjs`) and are copied into `data.json` so the UI
renders the breakdown from the same numbers the ranking used.

| Component | Max | Rule |
|---|---|---|
| Taste | 45 | Direct match 45, or 40 if matched inside a longer billing. Adjacent match 20, or 17 the same way. |
| Urgency | 20 | The higher of two axes. **Onsale:** opens within 7 days 20, within 30 days 12, later 5, already on sale 4, unknown 4. **Proximity:** show within 14 days 18, within 30 days 12, within 60 days 7, beyond 3. |
| Effort | 20 | SF venue 20. Near East Bay 14. Peninsula or South Bay 8. Then subtract 6 if the show is Mon–Thu. Floor at 0. |
| Price | 15 | `priceRanges[0].min` at or under 40% of your ceiling: 15. Under ceiling: 10. Over ceiling: 0. **Not published: not scored** — see below. |

### Why urgency has two axes

The original spec scored urgency on onsale timing alone. Measured against the live
API that component is a **constant**: of 200 sampled events, **zero** had a future public
onsale and one had a future presale. Ninety days out, everything is already on sale, so
the rule fired identically for every show and contributed no ranking information.

The insight it was reaching for — scarcity forces a decision — is real, so it is kept on
the axis the data actually carries: how soon the show is. A show in nine days is a
decision you make now; one in eighty is not. The onsale rule remains as an override for
the case it was written for, a newly announced tour, and still wins outright when it fires.

### Why a missing price is not scored

Roughly **70% of events carry no `priceRanges` at all** (141 of 200 sampled), and big rooms
are the worst offenders. The original flat "7 out of 15" for missing data therefore went to
most of the list and flattened it. Instead, an event with no published price is scored out
of **85** on the three components that do have data, and both the card and the breakdown say
so. The final score is normalized to 0–100 so an 85-denominator show stays comparable to a
100-denominator one: both answer "what fraction of the points this event could have earned
did it earn."

Guessing a price would break principle 3. Averaging one in as a flat score quietly does the
same thing to the ranking. Until a priced source exists, "No price published" is the honest
output — see **Roadmap → Real prices** for what closing that gap would take.

Reason strings are assembled from the components that actually fired, in order. A component that did
not fire contributes no clause, and only the urgency axis that actually set the score speaks:

> Direct match: Usher, Chris Brown. 8 days out. Santa Clara venue, Friday. No price published.

"On sale now" earns no clause. It was true of every event in the window, so it says nothing about
whether to go.

### Refreshing

The refresh button runs in two modes, because **the API key must never reach the browser** — the
deployed page is public and static, so any key it held would be readable by anyone who opened
devtools.

| Where | What Refresh does | Backed by |
|---|---|---|
| `npm run dev` (local) | Genuinely re-queries Ticketmaster, re-scores, rewrites `data.json`, re-renders. ~4s for the full 1000-event crawl. | `scripts/dev-server.mjs`, which holds the key server-side and exposes `POST /api/refresh` |
| GitHub Pages (deployed) | Re-reads the published `data.json` and re-renders if it moved | `.github/workflows/refresh.yml`, which rebuilds at 06:00 and 18:00 Pacific using the key from repository secrets |

The page detects which mode it is in by probing `/api/capabilities`, and the note under the button
says which refresh it is actually performing rather than implying a live query it cannot make.

The scheduled workflow compares the *shows and cut arrays* rather than the raw file, because
`generatedAt` and `source.window` move on every run — a textual diff would redeploy twice a day
forever with an identical ranking. It can also be run on demand from the Actions tab.

`src/pipeline.mjs` holds the whole fetch → match → score pass so the CLI build and the refresh
endpoint run byte-identical logic. A refresh that ranked differently from a build would undermine
the score in exactly the way this product exists to avoid.

### Deduplication

One card per artist. A three-night run is one decision, not three. The extra nights go to the cut
list with a stated reason rather than being silently dropped — same rule as everything else that gets
filtered.

---

## Deploy

**GitHub Pages**, served from the `gh-pages` branch, which holds the contents of `public/`:

```bash
npm run build:data     # regenerate against live Ticketmaster data
git commit -am "refresh data"
npm run deploy         # git subtree push --prefix public origin gh-pages
```

There is no build step on the host. `data.json` is generated locally and committed, so the deployed
site is a pure static artifact and **the API key never touches the host**.

**Single file.** `npm run bundle` writes `dist/live-event-rec.html` — stylesheet, script, and data inlined
into one self-contained file. Opens by double-click, works offline, needs no host at all. Useful for
sending to someone directly.

`vercel.json` is also checked in if you'd rather host there. Import the repo as-is — the project
lives at the repository root, so leave Vercel's root directory unset; `vercel.json` already points
the output directory at `public`.

---

## Roadmap — the cuts, named honestly

1. **Source coverage.** Ticketmaster misses indie venues. Adding DICE and Eventbrite is the
   difference between a tool for arena shows and a tool for going out in SF.
2. **Rarity signal.** "First Bay Area date in two years" is the single strongest yes-flipper, and it
   is deliberately absent. The Discovery API carries no tour history, and guessing it would mean
   inventing a fact. Needs a real tour-history source.
3. **Real prices.** See below — the measured gap, and the one worth fixing first.
4. **Calendar conflicts.** Shows overlapping a busy block should move to their own "Worth it, but
   you are busy" bucket rather than being ranked as if the night were free. Cut for scope, not
   because it is unimportant — it is the second-strongest friction signal after venue distance.
5. **Group coordination.** The real blocker on a maybe is often whether a friend is in. A share link
   with a one-tap yes.

### Roadmap → Real prices

Not in scope today. Recorded here because it is the sharpest constraint on the product and the
research is already done.

**The gap is worst exactly where it hurts.** Measured across 600 sampled events:

| Venue type | Events with a published price |
|---|---|
| Stadiums, arenas, amphitheatres, pavilions | **1 of 58 — 2%** |
| Everything smaller | 176 of 542 — 32% |

Arena acts are precisely the artists on the seed list, which is why every shortlisted show reads "No
price published", and why raising the ceiling from $200 to $300 changed nothing. Confirmed not to be
a fetch bug: the single-event detail endpoint (`/discovery/v2/events/{id}`) returns no `priceRanges`
either, and only `standard` price types ever appear — never resale.

**Every route to real prices is a partnership, not a signup.** All were checked:

| Route | Gives | Status |
|---|---|---|
| Ticketmaster **Commerce API** | Real offers and price levels | **Partner only.** Verified `401 oauth.v2.InvalidApiKeyForGivenResource` on this key. "Access to the Partner Commerce API is typically restricted to a select few business partners." Contact `partnersupport@ticketmaster.com`. |
| Ticketmaster **Inventory Status API** | Sold-out / limited / few-left — a genuine scarcity signal | **Partner only.** Same 401 on this key. |
| **SeatGeek Platform API** | `stats.lowest_price`, `stats.average_price`, resale included | **Application only.** `portal.seatgeek.com` has no self-serve credential flow — it gates access behind a "Get Access" form and manual approval. |
| Ticketmaster **Affiliate Program** (via Impact) | Affiliate links across TM, TicketWeb, Universe, Front Gate, Moshtix | **Application, approval required.** Grants link and commission access; expanded price data is not a stated benefit. |
| Scraping StubHub / Vivid / SeatGeek web | Prices | **Rejected.** Breaks their terms, selectors rot, and unverifiable prices would undermine the one thing this product sells — that every number traces to a source. |

The realistic near-term path is the **Ticketmaster Affiliate Program**: the only one with an open
application form, and the only one that would also let the "Get tickets" links earn anything. It is
not guaranteed to unlock pricing.
