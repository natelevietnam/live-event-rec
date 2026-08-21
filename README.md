# Worth It

You give it the artists you would actually go see. It returns a short ranked list of Bay Area shows
worth your money in the next 90 days — each with a reason — plus a visible list of what it rejected
and why.

Bandsintown tells you an artist you follow is playing. It cannot tell you whether to go. This decides.

**The insight:** the thing that flips a maybe into a yes is rarely the artist. It is scarcity and
friction. Onsale closes Thursday. It is a Wednesday in Mountain View and you have a 9am. No existing
tool weighs those together, so you decide from a flat feed of forty equally-weighted rows.

---

## Design principles

These are load-bearing, not decoration.

1. **No runtime LLM.** Every reason string is assembled in `src/reason.mjs` from the actual scoring
   inputs. The product structurally cannot hallucinate a reason for a show.
2. **Show the cut.** Rejected shows are listed with their reasons. Showing your work on what was
   filtered out is the credibility of a ranking product.
3. **No invented facts.** If a signal is not in the source data it does not appear in the UI. Missing
   prices read "Price TBD" and are never estimated.
4. **No accounts, no auth, no login, no database.** Static build output.
5. **Ship the loop, not the breadth.** One clean end-to-end pass beats three half-features.

---

## Running it

```bash
cp .env.example .env          # paste a free key from developer.ticketmaster.com
$EDITOR config/artists.json   # 20–30 artists you would actually go see

npm run verify                # Step 0 — proves the query returns real Bay Area events
npm run build:data            # fetch, match, score, write public/data.json
npm run serve                 # open the page locally
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
| 1 | `dmaId=382` — San Francisco / Oakland / San Jose |
| 2 | `geoPoint=9q8y` with `radius=50&unit=miles` |
| 3 | `city=San Francisco` |

Which one was actually used is printed at build time and stated in the page footer.

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
same thing to the ranking.

Reason strings are assembled from the components that actually fired, in order. A component that did
not fire contributes no clause, and only the urgency axis that actually set the score speaks:

> Direct match: Usher, Chris Brown. 8 days out. Santa Clara venue, Friday. No price published.

"On sale now" earns no clause. It was true of every event in the window, so it says nothing about
whether to go.

### Deduplication

One card per artist. A three-night run is one decision, not three. The extra nights go to the cut
list with a stated reason rather than being silently dropped — same rule as everything else that gets
filtered.

---

## Deploy

Vercel, static output, `public/` as the output directory. `vercel.json` is checked in. There is no
build command on Vercel: `data.json` is generated locally by `npm run build:data` and committed, so
the deployed site is a pure static artifact and the API key never touches the host.

---

## Roadmap — the cuts, named honestly

1. **Source coverage.** Ticketmaster misses indie venues. Adding DICE and Eventbrite is the
   difference between a tool for arena shows and a tool for going out in SF.
2. **Rarity signal.** "First Bay Area date in two years" is the single strongest yes-flipper, and it
   is deliberately absent. The Discovery API carries no tour history, and guessing it would mean
   inventing a fact. Needs a real tour-history source.
3. **Calendar conflicts.** Shows overlapping a busy block should move to their own "Worth it, but
   you are busy" bucket rather than being ranked as if the night were free. Cut for scope, not
   because it is unimportant — it is the second-strongest friction signal after venue distance.
4. **Group coordination.** The real blocker on a maybe is often whether a friend is in. A share link
   with a one-tap yes.
