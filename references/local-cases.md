# Local test-case fallback

Used when Qase is unreachable, the token is missing, or the user wants everything offline. Same information, same IDs, no network.

Location: `test-cases/` at the repo root. One file per case: `test-cases/<ID>.md`.

## Format

```markdown
---
id: BOR-12
title: Search by last name is case-insensitive
suite: Borrower Search > Filtering
priority: high
severity: major
status: actual
tags: [regression, bug-guard]
guards: BUG-3
automated: false
---

## Preconditions

API running on http://localhost:4000 with default seed data (60 borrowers, 3 named "Smith").

## Steps

1. **Action:** Open `http://localhost:3000`
   **Expected:** The borrower table renders with the first page of results.

2. **Action:** Type `smith` (lowercase) into the "Search borrowers" field.
   **Expected:** Exactly 3 rows are shown, all with last name "Smith".

3. **Action:** Read the result count above the table.
   **Expected:** It reads "3 borrowers".

## Notes

Regression guard for BUG-3: `server/routes.js:38` compared the raw query against the
unlowercased field, so a lowercase query matched nothing.
```

## ID allocation

`<PROJECT>-<n>`, where `<PROJECT>` is a short uppercase prefix for the app under test (`BOR` for borrower search). Scan `test-cases/` for the highest existing `n` and continue from there. Never reuse an ID.

## Migrating to Qase later

The frontmatter maps 1:1 onto `qase_case_upsert` fields, so a local case can be pushed up later without rewriting it. If the user reconnects Qase mid-session, offer to sync — and update the local file's `id` if Qase assigns a different number.
