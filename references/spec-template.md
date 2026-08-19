# Traceable Playwright spec template

## Header block

```js
/**
 * @qase-id       <PROJECT>-<n>          Case ID in the TMS. Required.
 * @qase-url      https://app.qase.io/case/<PROJECT>/<n>
 * @title         <case title, verbatim from the TMS>
 * @suite         <Suite > Sub-suite>
 * @priority      low | medium | high
 * @preconditions <what must be true before the test runs>
 * @covers        <source globs this test exercises, space-separated>
 * @guards        BUG-<n> — <one-line description of the defect this pins>   (regression tests only)
 * @generated-by  qa-tms:codegen
 */
```

Rules:
- `@qase-id` is the join key. It appears in the JSDoc, in the Playwright `tag`, and in the test title. All three must agree.
- `@title` is copied verbatim so drift between the case and the test is greppable.
- `@guards` appears **only** on tests written to pin a specific defect. Its absence means "this is a normal coverage test".
- `@covers` lists the source files this test actually exercises, as paths or globs relative to the repo root (`server/routes.js`, `client/src/**/*.jsx`). It is what CI reads to decide whether a diff needs this test.

### About `@covers`

This is the one field written for a machine rather than a reader. `scripts/select-tests.mjs` builds a coverage map from it so a PR runs only the specs its diff can affect — see the intelligent-runner workflow.

Get it from what the test actually touched, not from what the feature is *about*: the endpoints the run hit, the components that rendered. Prefer a file over a directory, and a directory over a wildcard. Over-broad globs are not a safe hedge — `server/**` on every spec makes the map useless and quietly returns CI to running everything.

Omitting it is safe but costly: a changed file that no spec claims escalates that PR to the full suite. That escalation is the intended fallback, not a failure — it is why an unannotated repo still gets correct results on day one, and why adding `@covers` to the specs you care about pays off incrementally.

## Full example

```js
import { test, expect } from '@playwright/test';

/**
 * @qase-id       BOR-12
 * @qase-url      https://app.qase.io/case/BOR/12
 * @title         Search by last name is case-insensitive
 * @suite         Borrower Search > Filtering
 * @priority      high
 * @preconditions API running with default seed data (60 borrowers, 3 named "Smith")
 * @covers        server/routes.js client/src/App.jsx
 * @guards        BUG-3 — a lowercase query returned zero results
 * @generated-by  qa-tms:codegen
 */
test(
  'BOR-12 — search by last name is case-insensitive',
  { tag: ['@qase:BOR-12', '@regression'] },
  async ({ page }) => {
    // Precondition: clean load of the search page
    await page.goto('/');

    // Step 1: enter "smith" (lowercase) in the search field
    await page.getByRole('textbox', { name: 'Search borrowers' }).fill('smith');

    // Step 2: expected — the 3 borrowers named "Smith" are listed
    await expect(page.getByRole('row')).toHaveCount(3 + 1); // +1 header row
    await expect(page.getByRole('cell', { name: /Smith/i })).toHaveCount(3);

    // Step 3: expected — the result count reflects the filtered set
    await expect(page.getByTestId('result-count')).toHaveText('3 borrowers');
  }
);
```

## Running by case ID

```bash
npx playwright test --grep @qase:BOR-12     # one case
npx playwright test --grep @regression      # all regression guards
```

## Optional: reporter linkage

Only if `playwright-qase-reporter` is already a dependency:

```js
import { qase } from 'playwright-qase-reporter';

test('BOR-12 — search by last name is case-insensitive', async ({ page }) => {
  qase.id(12);
  // ...
});
```

Do not add this dependency solely to use it — the JSDoc header plus the tag already gives full traceability without a build-time coupling.
