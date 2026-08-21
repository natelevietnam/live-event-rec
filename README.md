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

Containment matching requires two or more tokens, so a short name like "XG" cannot match inside an
unrelated event title. Everything matching neither tier is cut with "no taste match".

### Scoring, 0–100

Weights live in one object (`WEIGHTS` in `src/score.mjs`) and are copied into `data.json` so the UI
renders the breakdown from the same numbers the ranking used.

| Component | Max | Rule |
|---|---|---|
| Taste | 45 | Direct match 45. Adjacent match 20. |
| Urgency | 20 | Onsale or presale opens within 7 days: 20. Within 30 days: 12. Already on sale: 8. Onsale date unknown: 5. |
| Effort | 20 | SF venue 20. Oakland or Berkeley 14. Peninsula or South Bay 8. Then subtract 6 if the show is Mon–Thu. Floor at 0. |
| Price | 15 | `priceRanges[0].min` at or under 40% of your ceiling: 15. Under ceiling: 10. Over ceiling: 0. Missing: 7, labelled "price TBD", never estimated. |

Reason strings are assembled from the components that actually fired, in order. A component that did
not fire contributes no clause:

> Direct match. Presale opens Tue Aug 25. SF venue, Saturday. From $68.

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
