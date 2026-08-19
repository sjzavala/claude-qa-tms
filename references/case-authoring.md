# Writing Qase cases that codegen can turn into good specs

For the workflow: **hand-write cases in the Qase UI → `/qa-tms:codegen` generates Playwright specs.**

The generated spec is only as precise as the case. Vague steps force the generator to
guess at selectors; precise steps make the mapping mechanical. This is the format to type
under time pressure.

## The rule

> Every step names **the element by its visible label or role**, and every expected result
> names **an observable value**.

Ambiguity in, guesswork out.

| Don't write | Write |
|---|---|
| Search for a borrower | Type `smith` into the **Search borrowers** field |
| Results appear | The table shows exactly **3** rows |
| Go to the next page | Click the **Next** button |
| Check the count | The result count reads **3 borrowers** |
| Filter by credit score | Enter `700` in **Minimum credit score** |
| It should work | The row for **Patricia Garcia** is visible |

## Field template

**Title** — behavior + expected outcome, no "and":
> `Search by last name is case-insensitive`

**Preconditions** — URL and data state:
> `App running at http://localhost:3000 with default seed data (60 borrowers, 3 named Smith)`

**Steps** — Qase gives each step three fields, in this order: **action**, **data**, **expected result**. Author them in that order; it's how the Qase UI lays the step out and how a tester reads it — *do this, with this input, and see this*.

| Action | Data | Expected result |
|---|---|---|
| Open the borrower search page | | The table renders with the first page of results |
| Type the term into the **Search borrowers** field | `smith` | Exactly 3 rows are shown, all with last name Smith |
| Read the result count above the table | | It reads `3 borrowers` |

Put the literal input in **data**, not buried in the action sentence. It's a first-class
field: it keeps the action reusable, it's what a tester copies and pastes, and
`/qa-tms:codegen` reads it as the literal value to drive the generated spec. `data` is
optional — leave it empty for steps that take no input, like the two above.

**Description** — for a regression case, name the defect:
> `Regression guard for BUG-5: server/routes.js:38 compared the raw query, so a lowercase search matched nothing.`

**Tags** — `regression`, `bug-guard`, plus a feature tag. These become Playwright tags.

## Formatting conventions that survive the round trip

- **Bold** an element's visible label — the generator maps it to `getByRole(..., { name: '…' })` or `getByLabel(…)`.
- `Backtick` literal input values and literal expected text. Never paraphrase a value.
- State exact counts (`3 rows`), not qualifiers (`several rows`).
- One behavior per case. A title needing "and" is two cases.
- Put the whole setup in preconditions, not step 1 — codegen turns preconditions into `beforeEach` or the opening `goto`.

## Speed shortcuts for live authoring

Typing full steps into the Qase UI is slow. Two faster paths:

1. **Terse steps are fine if values are literal.** `Type \`smith\` in **Search borrowers**` → `3 rows` is enough. Grammar doesn't matter; precision does.
2. **Let `/qa-tms:case` draft, then edit in the UI.** Faster than typing from scratch and the output already follows this format. Hand-write only the cases you want to be seen hand-writing.

## What codegen does when a case is vague

It will **not** silently guess. It opens the page, snapshots the accessible tree, and
resolves the real role and accessible name before writing a selector. If it still can't
resolve a step unambiguously, it says so and asks rather than emitting a plausible-looking
test built on a made-up selector.
