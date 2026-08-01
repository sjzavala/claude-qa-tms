---
description: Generate a Playwright spec from a TMS test case, with a JSDoc header and tags that trace the test back to its case ID. Use when asked to automate a test case, write a Playwright test for a case, or turn manual cases into regression tests.
---

# Generate a traceable Playwright spec

Input: **$ARGUMENTS** — one or more case IDs. If empty, ask which case(s), or use the ones just verified in this conversation.

## Step 1 — Fetch the case

`qase_get` with `{entity: "case", code: "<PROJECT>", id: <n>}` per ID. You need: title, suite, priority, preconditions, and each step's action + expected result. Fall back to `test-cases/` locally if Qase is unavailable.

Tool names and params: `references/qase-tools.md` — the published Qase README is wrong about several of them.

**Verify first if you haven't.** Generating a spec from a case you've never executed produces plausible-looking tests with wrong selectors. If the case hasn't been run in this session, use the browser to confirm the real accessible names and roles before writing code — `browser_snapshot` on the relevant page is enough.

## Step 2 — Match the repo (do not skip — this is where generated tests get rejected)

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

**Conflicts resolve toward the repo.** If house style contradicts the guidance in Step 4, house style wins — except for correctness rules (no hard waits, no non-retrying assertions), which you should follow and mention.

If the repo has **no** existing Playwright setup, say so and ask before scaffolding one — adding a framework is a bigger decision than adding a test.

## Step 3 — Write the spec

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

## Step 4 — Test-writing rules

These matter more than the header. A durable test:

- **Selects by role and accessible name**: `page.getByRole('textbox', { name: 'Search borrowers' })`. Fall back to `getByLabel`, then `getByTestId`. Never CSS/XPath tied to markup structure or generated class names.
- **Asserts with web-first assertions** — `await expect(locator).toHaveText(...)` — which auto-retry. Never `waitForTimeout`. Never a bare `expect(await locator.textContent())`.
- **Asserts on values, not just presence.** `toHaveCount(3)` beats `toBeVisible()`. Pin the number the case specifies.
- **One behavior per test.** The case is one behavior; the test is one behavior. If you're writing a second distinct assertion theme, it's a second test and probably a second case.
- **Is order-independent.** No reliance on a prior test's state. Set up what you need in the test or a fixture.
- **Uses the literal data from the case.** If the case says search `smith`, the test searches `smith` — not a variable named `SEARCH_TERM` set to something else.

### Synchronization — where generated tests silently lie

A regression guard that fails for the wrong reason is worse than no test: it sends the developer after the wrong defect, and a spurious *pass* hides a real one. Three rules, each learned from a real miss:

1. **Settle the initial load before interacting.** Apps that fetch in `useEffect` without an abort or sequence guard — and React StrictMode double-fires that effect in dev — will land a stale baseline response *after* your interaction, overwriting the filtered state. `await page.waitForLoadState('networkidle')` after `goto` before the first action. Symptom you missed it: the test reports the unfiltered row count.

2. **Never assert on a one-shot read.** `for (const t of await locator.allTextContents())` does not retry, so it races any pending response. Use `await expect.poll(async () => …).toBe(true)` instead. Symptom: the assertion sees pre-interaction data.

3. **Order assertions so a spurious pass is impossible.** Put the *retrying* assertion that proves the new state arrived **first**; put the specific assertion the case is really about **after** it. Reversed, a specific check can pass against stale data and report false green — the most dangerous outcome in this whole workflow.

When the app under test has a known async defect, say so in a code comment next to the wait, referencing the bug. It explains to the next reader why the wait is not cargo-culted.

Map each case step to a commented block so the mapping stays legible:

```js
// Step 2: enter "smith" (lowercase) in the search field
```

## Step 5 — Run it

Run the generated spec (`npx playwright test <file>`) and report the real result.

- **If it's a regression guard for an unfixed bug, it should FAIL.** Say so explicitly: "This fails as expected — it pins BUG-3, and will pass once the trailing-space handling is fixed." A failing guard is the deliverable, not a problem. Do not adjust the assertion to make it green.
- If it fails for any *other* reason — bad selector, wrong URL, timing — that's your bug, fix it and re-run.
- Never report a test as working without having run it.

## Step 6 — Report

List each generated file, its case ID, and its actual run status (pass / fails-as-designed / broken). Then offer to push the automation status back to Qase via `qase_case_upsert` (marking the case automated) if the user wants the traceability to be bidirectional.
