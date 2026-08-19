---
description: Generate a Playwright spec from a TMS test case, with a JSDoc header and tags that trace the test back to its case ID. Use when asked to automate a test case, write a Playwright test for a case, or turn manual cases into regression tests.
---

# Generate a traceable Playwright spec

Input: **$ARGUMENTS** — one or more case IDs in `<PROJECT>-<n>` form, exactly as Qase displays them (e.g. `ACME-42`). If empty, ask which case(s), or use the ones just verified in this conversation.

## Step 1 — Resolve each ID, then fetch the case

Split each argument on the **last** hyphen: left side is the project `code`, right side is the numeric `id`. So `ACME-42` → `{code: "ACME", id: 42}`.

`qase_get` with `{entity: "case", code: "<PROJECT>", id: <n>}` per ID — `id` as a number, never the combined string. Take the code from the argument itself; the examples here are illustrative only. You need: title, suite, priority, preconditions, and each step's action + expected result. Fall back to `test-cases/` locally if Qase is unavailable.

Keep **both** forms — the spec needs each in a different place (see `references/spec-template.md`):

| Where | Form | Shape (for `ACME-42`) |
|---|---|---|
| `@qase-id` JSDoc line | display | `ACME-42` |
| Playwright `tag` | display, prefixed | `@qase:ACME-42` |
| `@qase-url` | split | `https://app.qase.io/case/ACME/42` |
| `qase.id()`, if the reporter is already a dep | numeric | `qase.id(42)` |

A spec generated from only the numeric id loses its trace back to the case.

Tool names and params: `references/qase-tools.md` — the published Qase README is wrong about several of them.

**Verify first if you haven't.** Generating a spec from a case you've never executed produces plausible-looking tests with wrong selectors. If the case hasn't been run in this session, use the browser to confirm the real accessible names and roles before writing code — `browser_snapshot` on the relevant page is enough.

## Step 2 — Decide whether this should be a UI test at all

Before writing code, judge the case as a regression candidate. Four questions:

1. **Impact** — does the behavior matter to a user or the business?
2. **Determinism** — is the expected outcome exact and stable? (`3 borrowers`, not "some results")
3. **Isolation** — can the behavior be exercised without dragging in unrelated flows?
4. **Layer** — is a browser genuinely needed, or is this really an API concern?

Report it in three lines, not a page:

```
Suitability:  high | medium | low
Layer:        UI | API | integration | unit | not recommended
Protects:     <the one behavior, in a sentence>
```

**Layer is the question that pays for this step.** If the defect lives in a response body, a filter comparison, or a sort order, an API test is cheaper, faster and more precise than clicking through pages — and sometimes the UI *cannot* see the defect at all, as when the API returns a field the UI masks. Say so plainly rather than generating a browser test that asserts less than the case demands.

If suitability is **low**, do not quietly generate a weak UI test. Say why and ask before continuing. If the better layer is below the UI but Playwright is still wanted, generate only the thinnest end-to-end coverage and state what it does *not* cover.

## Step 3 — Match the repo (do not skip — this is where generated tests get rejected)

You are writing into **someone else's** Playwright setup. Discover its conventions before writing a line. Read, in this order:

1. **`playwright.config.*`** — `testDir`, `baseURL` (if set, use relative `page.goto('/')`, never a literal host), `projects`, `webServer`, global setup, custom `use` options, reporters.
2. **Two existing specs** — the ones most similar to what you're generating. Extract:
   - import style (`@playwright/test` directly, or a local `test` re-export with custom fixtures)
   - **custom fixtures** — if specs take `{ borrowerPage }` rather than `{ page }`, use the fixture
   - **page objects / helpers** — if a `pages/`, `fixtures/`, `helpers/`, or `support/` directory exists, use those abstractions rather than raw locators
   - selector convention — do they already standardize on `getByTestId`? Then match it, even though `getByRole` is the general default
   - naming: file names (`*.spec.ts` vs `*.test.ts`), test titles, `test.describe` grouping
   - TypeScript or JavaScript — match exactly, including whether types are annotated
3. **`package.json`** — the actual test script, and whether `playwright-qase-reporter` is already a dependency.

Then place the file where the repo already puts specs (`tests/`, `e2e/`, `__tests__/`) and name it the way its neighbors are named.

Also note, **if they exist**, whatever the repo already uses for auth setup, data factories or seed utilities, API helpers, and cleanup — and use them rather than inventing a parallel pattern. If the app under test is read-only with fixed seed data, skip this; there is nothing to isolate.

Summarize the conventions you'll follow in a line or two before writing, so a reviewer can see the spec wasn't written blind.

**Conflicts resolve toward the repo.** If house style contradicts the guidance in Step 5, house style wins — except for correctness rules (no hard waits, no non-retrying assertions), which you should follow and mention.

If the repo has **no** existing Playwright setup, say so and ask before scaffolding one — adding a framework is a bigger decision than adding a test.

## Step 4 — Write the spec

Every generated test carries the traceability header from `references/spec-template.md`. The non-negotiable parts:

```js
/**
 * @qase-id       BOR-12
 * @qase-url      https://app.qase.io/case/BOR/12
 * @title         Search by last name is case-insensitive
 * @suite         Borrower Search > Filtering
 * @priority      high
 * @preconditions API on :4000 with default seed data
 * @guards        BUG-3 — lowercase query returned zero results
 * @generated-by  qa-tms:codegen
 */
test(
  'BOR-12 — search by last name is case-insensitive',
  { tag: ['@qase:BOR-12', '@regression'] },
  async ({ page }) => { /* ... */ }
);
```

- The `@qase-id` in the JSDoc and the `@qase:<ID>` tag must agree. The tag makes it runnable: `npx playwright test --grep @qase:BOR-12`.
- `@guards` is only present on regression tests written for a specific bug — it's the line that tells a future maintainer why the test exists and why deleting it is dangerous.
- If the repo has `playwright-qase-reporter` installed, also call `qase.id(12)` inside the test body so results auto-link on the Qase side. Do not add the dependency yourself just to use it.

**Show the spec in full for review.** After writing the file, print the complete generated
code in your response — not a summary, not just the path. The reader should be able to
review the locators, the assertions and the step mapping without opening the file, and
should be able to object to any of it before it becomes the artifact. Call out anything
non-obvious in one or two lines beneath it: an assertion that exists to prevent a false
pass, a wait that has a defect behind it, a place where you followed house style over the
default guidance.

Then run it (Step 6). If the user asks to review before running, stop after printing the
code and wait — otherwise print, run, and report together so it stays one pass.

## Step 5 — Test-writing rules

These matter more than the header. A durable test:

- **Selects by role and accessible name**: `page.getByRole('textbox', { name: 'Search borrowers' })`. Fall back in this order — `getByLabel` → `getByPlaceholder` → text that carries business meaning → repo-approved `getByTestId` → CSS only when nothing semantic exists. Never `nth-child`, generated class names, deeply nested CSS, or XPath unless the repo already standardizes on it.
- **Names the behavior it protects.** `returns borrowers matching a last-name search` — not `search works`, `borrower test`, or `case 42`. The title is what someone reads in a failure report, often without opening the file.
- **Asserts with web-first assertions** — `await expect(locator).toHaveText(...)` — which auto-retry. Never `waitForTimeout`. Never a bare `expect(await locator.textContent())`.
- **Asserts on values, not just presence.** `toHaveCount(3)` beats `toBeVisible()`. Pin the number the case specifies.
- **One behavior per test.** The case is one behavior; the test is one behavior. If you're writing a second distinct assertion theme, it's a second test and probably a second case.
- **Is order-independent.** No reliance on a prior test's state. Set up what you need in the test or a fixture.
- **Uses the literal data from the case.** A Qase step carries its input in the `data` field, separate from `action` and `expected_result` — that value is what the test drives. If the step's `data` is `smith`, the test types `smith`, not a variable named `SEARCH_TERM` set to something else. When `data` is empty the step takes no input; don't invent one.

### Synchronization — where generated tests silently lie

A regression guard that fails for the wrong reason is worse than no test: it sends the developer after the wrong defect, and a spurious *pass* hides a real one. Three rules, each learned from a real miss:

1. **Settle the initial load before interacting — but synchronize on state, not on the network.** Default to waiting for user-visible, business-relevant state: an expected count, a named record, an enabled control, a completed loading indicator. Reach for `await page.waitForLoadState('networkidle')` **only** when the app fetches without an abort or sequence guard — React StrictMode double-fires `useEffect` in dev — so a stale baseline response can land *after* your interaction and overwrite the filtered state. When you do use it, put the bug reference in a comment beside it; an unexplained `networkidle` reads as cargo cult and gets deleted by the next maintainer. Never reach for it as a general-purpose "wait for the page." Symptom you got this wrong: the test reports the unfiltered row count.

2. **Never assert on a one-shot read.** `for (const t of await locator.allTextContents())` does not retry, so it races any pending response. Prefer a web-first assertion that already retries; use `await expect.poll(async () => …)` only when no assertion expresses the condition (e.g. "more than 3 rows"). Symptom: the assertion sees pre-interaction data.

3. **Order assertions so a spurious pass is impossible.** Put the *retrying* assertion that proves the new state arrived **first**; put the specific assertion the case is really about **after** it. Reversed, a specific check can pass against stale data and report false green — the most dangerous outcome in this whole workflow.

When the app under test has a known async defect, say so in a code comment next to the wait, referencing the bug. It explains to the next reader why the wait is not cargo-culted.

Map each case step to a commented block so the mapping stays legible:

```js
// Step 2: enter "smith" (lowercase) in the search field
```

## Step 6 — Run it, then classify the result

Run the focused spec (`npx playwright test <file>`) and report the real result.

**A red test is not a failed codegen attempt.** A regression guard written against a live defect is *supposed* to fail. Treating every failure as your own bug leads to the worst outcome in this workflow: quietly weakening the assertion until it goes green, which ships a test that protects nothing.

First answer the one question everything turns on: **was the primary assertion actually reached?** Read the failure location and message, then compare the observed behavior against the case's expected result, the documented actual behavior from verification, and the assertion the case is really about.

| Verdict | When | What to do |
|---|---|---|
| **Regression captured** | Setup and actions completed, the primary assertion was reached, and it failed because the known defect is still present — observed behavior matches the documented actual result | **This is success.** Report it as the deliverable: what it pins, and what will make it go green. Do not touch the assertion. |
| **Not reproduced** | The primary assertion was reached and *passed* | The defect may be fixed, intermittent, or environment-dependent. Keep the test if the requirement is valid — and if this contradicts the verification run, say so plainly rather than treating green as good news. |
| **Test implementation failure** | The run died before proving anything — bad locator, wrong route, missing setup, syntax error, arbitrary timeout, stale selector — or went red for a reason the case never mentions | Your bug. Diagnose, fix, re-run. |
| **Environment failure** | App won't start, API unreachable, dependency down, unrelated 5xx | Neither a captured regression nor a test bug. Say what's down and stop; a fail caused by a missing server is not evidence of anything. |
| **Inconclusive** | Intermittent across runs, or the behavior matches neither the expected nor the documented-actual result | Say what evidence is missing instead of guessing. |

The dangerous misclassification is calling an environment or locator failure a *captured regression* — it reports a defect as pinned when nothing is guarding it. Prove the assertion was reached before you claim the first row.

Never report a test as working without having run it.

## Step 7 — Report

List each generated file, its case ID, and its actual run status (pass / fails-as-designed / broken). Then offer to push the automation status back to Qase via `qase_case_upsert` (marking the case automated) if the user wants the traceability to be bidirectional.
