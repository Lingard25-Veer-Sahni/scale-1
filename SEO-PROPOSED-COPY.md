# Proposed copy, pending your approval

Branch: `seo/crawlability-and-metadata`. Nothing here is live.

Two kinds of wording are listed below.

- **Section A** is already written into the branch (it is metadata, not visible
  page copy) but it only reaches the public when you approve a deploy. If you
  want any of it changed, say so and I will edit it before anything ships.
- **Sections B and C** are **not implemented anywhere**. They are drafts. No
  component, route or page was touched for them. They ship only if you say so.

Every line uses only the verified facts. No invented dates, partners,
testimonials or rankings. No superlatives such as "India's first" are used in
any title, description or structured data, even though that phrase appears in
your existing on-page copy (which I have not changed).

---

## Section A. Page titles and meta descriptions

The title is the blue clickable line in a Google result. The description is the
grey text under it. Google shows roughly 60 characters of title and roughly 155
of description, so the counts matter.

### Home, `/`

| | |
|---|---|
| Title (56) | `SCALE \| Business Case Competitions for Students in India` |
| Description (144) | `SCALE runs business case competitions, expert sessions and free online courses in business, finance and leadership for school students in India.` |

### Course listing, `/courses`

| | |
|---|---|
| Title (47) | `Free Online Courses for School Students \| SCALE` |
| Description (144) | `Free, self-paced SCALE courses for school students. Each lesson has a video, slides, a written summary and a quiz. No fees and no paid upgrades.` |

### Course, `/courses/personal-finance-money-decisions`

| | |
|---|---|
| Title (56) | `Personal Finance & Money Decisions \| Free Course \| SCALE` |
| Description (149) | `A free SCALE course on managing money: budgeting, banking and UPI, earning and taxes, debt, insurance, scams, and building a personal financial plan.` |

### Competition, `/events/67365362-6e51-4339-b5e1-0e1e2468d710`

| | |
|---|---|
| Title (62) | `SCALE Business Case Competition \| Free Online Case Competition` |
| Description (150) | `A free online business case competition for school students in India. Solve the Lenskart FY26 case on your own; Round 1 decks are due 20 January 2027.` |

Any future event or course you create gets a title of `<its title> | SCALE` and
a description trimmed from its own description field, automatically. You only
need to add an override (in `frontend/scripts/seo-config.js`) when you want
something better than that default.

### Loading screen

The old loading screen said only "Loading SCALE…", which is a blank page as far
as a search engine or an AI assistant is concerned. It now reads:

> **SCALE**
> Society of Commerce, Analytics, Leadership and Entrepreneurship. SCALE runs
> business case competitions, expert sessions and free online courses for
> school students in India.
> [Free courses] [scalesupportteam2@gmail.com]
> Loading…

This is the only change to wording that a visitor can actually see. Everything
else in Section A lives in the page source.

---

## Section B. One home-page mention of the competition — NOT IMPLEMENTED

The brief asked for one short factual section or sentence on the home page that
links to the competition. Right now the home page lists events generically; it
never names the competition in prose, so there is no sentence for a search
engine or an assistant to quote.

**Proposed: one sentence added under the Events heading.**

> SCALE's current competition is the SCALE Business Case Competition, a free
> individual online case competition for school students; Round 1 decks are due
> 20 January 2027. [Read the full rules and get the case](link to event page).

Notes on the wording:

- "free", "individual", "online", "school students" and the Round 1 date are
  all verified facts, so each is a phrase a search engine can match a query
  against.
- No prize figure here on purpose: it is on the competition page where the full
  breakdown is, and repeating a number in two places means two places to update.
- No em dashes, as you asked.

Tell me yes and I will add it to the home page. Tell me no and the branch stays
as it is.

---

## Section C. Competition explainer and FAQ — NOT IMPLEMENTED

The brief asked for a plain-language explainer plus an FAQ, either as sections
on the event page or as a new `/case-competition` page.

**My recommendation: put them on the existing event page, and do not create a
new route.** Reasons:

- The UUID URL `/events/67365362-...` is already printed in your materials and
  shared with students. It must keep working, which it does either way.
- A second URL about the same competition splits whatever ranking signal the
  page earns between two addresses, and then needs a canonical tag to tell
  Google which one counts. That is one more thing to get wrong for no gain
  while there is a single competition.
- If you later run several competitions a year, a permanent
  `/case-competition` landing page that always points at the current one starts
  to make sense. At that point it is a small change.

So: **canonical stays `https://www.scale-national.com/events/67365362-6e51-4339-b5e1-0e1e2468d710`**, and the explainer and FAQ become visible sections on that page.

### Proposed explainer (one paragraph, above the existing About text)

> The SCALE Business Case Competition is a free online business case
> competition for school students in India. You enter on your own, there are no
> teams. In Round 1 you read the Lenskart case packet, decide where the
> company's next rupee of growth investment should go, and submit a short PDF
> deck by 20 January 2027. The ten highest scoring entries go through to Round
> 2 and pitch live to judges. The total prize pool is 15,000 rupees.

### Proposed FAQ (visible on the page, as a list of questions and answers)

**Who can enter?**
School students. Entries are individual only, so there are no teams.

**Does it cost anything?**
No. Entry is free.

**Is it online?**
Yes. Round 1 is an online submission. The top ten scorers pitch live to judges
in Round 2.

**What do I have to submit for Round 1?**
A short deck as a PDF, submitted through the Round 1 submission form on this
page, by 20 January 2027.

**What is the case?**
Lenskart's FY26 numbers. You decide where the company's next marginal rupee of
growth investment should go. The full case packet is attached on this page.

**What are the IndiGo files for?**
They are a sample case and a sample worked solution, included to show the
expected format and depth. They are a reference only. They are not the case you
are solving and they are not a template to copy.

**How is it judged?**
Against the rubric and the case-specific judging checklist in the "Rules &
Format" packet attached on this page.

**What are the prizes?**
A total prize pool of 15,000 rupees: 10,000 rupees for first place and 5,000
rupees for second place.

**Do I need to register first to see the materials?**
No. The rules, the rubric, the case packet and the samples are all openly
available on this page.

If you approve the FAQ, it also gets `FAQPage` structured data, which is only
added because the questions and answers are genuinely visible on the page.
Marking up an FAQ that a visitor cannot see is against Google's rules.

---

## What to tell me

For each of B and C: approve as written, approve with edits, or skip. Section A
I will adjust on request. Nothing merges or deploys until you say so.
