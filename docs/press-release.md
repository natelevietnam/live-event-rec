# Live Event Rec

**A ranked verdict on which Bay Area shows are worth your money — and a visible list of everything it rejected.**

San Francisco, August 21, 2026 — **[natelevietnam.github.io/live-event-rec](https://natelevietnam.github.io/live-event-rec/)**

---

## The problem

There are about **1,000 music events** in the Bay Area over the next 90 days. Every tool that exists
will happily show you all of them.

Bandsintown tells you an artist you follow is playing. Ticketmaster tells you tickets exist. Neither
can tell you whether to go — so you end up scanning forty equally-weighted rows and closing the tab.
The decision gets deferred, and deferring is how you miss the show.

The thing that actually flips a maybe into a yes is rarely the artist. It is **scarcity and
friction**. The show is in nine days. It is a Monday in Mountain View and you have a 9am. The venue
is 40 minutes each way. No existing tool weighs those against each other, because a feed is not
allowed to have an opinion.

## The product

Live Event Rec takes the artists you would actually go see and returns **a short ranked list —
usually six shows — each with a reason.** From 1,000 events in the current window it shortlists 6 and
cuts 994.

Every one of those 994 is listed, with why. These are real rows from the current build:

> *Noah Kahan — Fri Aug 21 — no taste match*
> *Daniel Caesar — Fri Aug 21 — scored 68, below the top 6*
> *USHER — Sat Aug 29 — later date for USHER, higher-scoring night already listed*
> *Oliver Tree — Sat Aug 22 — cancelled*

**Showing the cut is the product.** A ranking you cannot audit is just a feed with confidence. If
the tool drops a show you wanted, you can see the reason and disagree with it.

**And it is yours to change.** Type your own artists, pick a genre, set how far you will travel, and
the list rebuilds instantly — in the browser, with no server round trip, because scoring never needed
the API key. Two people get two different answers from the same 1,000 events, and a configured list
is shareable as a URL.

Each show is scored 0–100 across three components — taste, urgency, effort — and the breakdown is one
click away, rendered from the same numbers the ranking used. The reason sentence is assembled from
the components that actually fired:

> **Direct match: Usher, Chris Brown. 8 days out. Santa Clara venue, Friday.**

## Why the reasons can be trusted

**No language model runs at request time.** Every reason string is assembled in code from the
scoring inputs. The product cannot hallucinate a reason for a show, because there is nothing in the
request path capable of inventing one.

The same rule governs missing data. Ticketmaster publishes no price for **any** of the events this
list matches — arenas carry one roughly 1 time in 58 — so price was removed as a scoring component
outright rather than shown as a permanently empty row or filled with an estimate. **If a signal is
not in the source, it does not appear in the UI. It goes in the roadmap instead.**

That discipline caught a real flaw during the build. The original scoring ranked urgency by when
tickets go on sale — but measured against the live API, **0 of 200 sampled events had a future
onsale**. Ninety days out, everything is already on sale. The component was a constant, three of the
four components were constants, and the "score" was secretly sorting by venue distance. It now
ranks on proximity to the show itself, which is a signal the data actually carries.

---

## Roadmap — the next three

**1. Indie coverage: DICE and Eventbrite.**
Ticketmaster covers big rooms well and small rooms barely. This is the difference between a tool for
arena shows and a tool for *going out in San Francisco*. It is the single change that most alters who
the product is for, and it is unblocked — both have documented APIs.

**2. Calendar conflicts.**
A show you are already busy for should not rank as if the night were free. Rather than silently
dropping those, they move to their own bucket — *"Worth it, but you are busy"* — because a conflict
is a fact about your week, not a fact about the show. The scoring seam for this already exists; it
was cut for scope, not for value.

**3. Rarity: "first Bay Area date in two years."**
The strongest yes-flipper there is, and deliberately absent today because the Discovery API carries
no tour history and guessing would mean inventing a fact. Candidate sources are setlist.fm and
MusicBrainz — with access terms verified before anything is promised, the same way the pricing routes
were.

**Blocked, not deferred: real prices.** Arena shows publish a price **1 time in 58**, so the price
ceiling cannot bite on exactly the artists that matter. Every route to fixing it — Ticketmaster's
Commerce and Inventory Status APIs, SeatGeek's Platform API — is partner-gated, verified by the 401s
they return. Scraping resellers would close the gap and is rejected: unverifiable prices would
destroy the one thing this product sells. **This is a business-development problem, not an
engineering one**, and the honest near-term move is the Ticketmaster Affiliate Program — the only
route with an open application form.

---

*Built as a TrashLab take-home. Source: Ticketmaster Discovery API v2. No accounts, no login, no
database — a static page plus a build script. Coverage gap stated plainly on the page itself.*
