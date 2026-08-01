---
description: Systematically explore a running web app with Playwright MCP to hunt for bugs. Drives a real browser, probes input classes and boundaries, watches the network for data leaks, and produces a ranked findings list in bug-report format. Use when asked to manually test, explore, smoke-test, or find bugs in a running app.
---

# Exploratory test sweep

Target: **$ARGUMENTS** (a base URL, e.g. `http://localhost:3000`; if empty, find the dev server URL from the repo's README or package.json scripts and ask before guessing).

You are acting as a QA engineer doing a timeboxed exploratory pass. Find real defects. Do **not** fix them unless explicitly asked — your job here is discovery and documentation.

## Phase 1 — Orient (fast, ~2 min)

Do these **before** touching the browser. They generate hypotheses that make browser time efficient:

1. Read the API layer (Express routes / handlers). Note for each endpoint: query params, defaults, pagination math, filter comparisons, sort implementation, and what fields the response actually contains.
2. Read the client's data-fetching and rendering code. Note: how requests are sequenced, whether responses are guarded against being stale, how user input is rendered back.
3. Note any seed/fixture data — knowing the dataset makes "expected" concrete instead of vague.

Write down 5–10 **specific hypotheses** before opening the browser. Example shape: "`total` is computed from the unfiltered array, so filtered results will show phantom pages."

## Phase 2 — Baseline

`browser_navigate` to the target, then `browser_snapshot`. Confirm the app loads and note the interactive surface: inputs, filters, sort controls, pagination, result rendering.

## Phase 3 — Attack

Work through these classes. For each, you have a hypothesis to confirm or refute — don't just click randomly.

**Input handling**
- Empty string, single space, leading/trailing whitespace
- Case variation (`smith` vs `Smith` vs `SMITH`)
- Partial vs exact match
- Unicode, accented characters, apostrophes (`O'Brien` — also a quoting/injection probe)
- XSS probe: `<img src=x onerror=alert(1)>` and `<b>bold</b>` — then check whether it renders as markup
- Very long string (500+ chars), and a string with regex metacharacters (`.*`, `(`, `[`)
- Numeric fields: `0`, negative, decimal, leading zeros, non-numeric text, values above and below the data range

**Boundaries**
- Range filters at exactly the boundary value — is it inclusive or exclusive? Compare against the code.
- Pagination: page 1→2 transition (check for a skipped or duplicated record), the last page, a page number beyond the end, page `0`, negative page
- Result counts: does the displayed total match the number of rows you can actually reach by paging?

**State and sequencing**
- Type quickly into a search box and watch whether a slower earlier response overwrites a newer one (stale-response race). Use `browser_network_requests` to confirm ordering.
- Apply a filter, then change the search term — is the filter still applied? Does the page number reset?
- Navigate back/forward; reload mid-state.

**Data exposure** — check `browser_network_requests` and inspect response bodies. Does the API return fields the UI masks or omits (SSNs, internal IDs, PII)? A UI that masks a value the API sends in full is a real finding.

**Error and empty states**
- A query that matches nothing — is the empty state correct and safe?
- Stop the API server, or hit an endpoint that 500s — does the client handle it or hang/blank-screen?

**Console** — call `browser_console_messages` after each significant interaction. Uncaught errors and React key/state warnings are free findings.

## Phase 4 — Confirm

For every anomaly, before you report it:
1. Reproduce it a second time from a clean page load.
2. Reduce it to the **minimum** steps that still trigger it.
3. Point at the specific line of code that causes it if you can — a bug report with `server/routes.js:42` in it is far more credible.
4. Capture evidence: `browser_take_screenshot` for visual/UI bugs, a `browser_network_requests` excerpt for API bugs.

Discard anything you cannot reproduce. A false positive costs more credibility than a missed minor bug.

## Phase 5 — Report

Output a summary table first, ranked by severity:

| # | Severity | Area | Summary |
|---|----------|------|---------|

Then one detailed block per finding, using the format in `references/bug-report-template.md`.

Finish with a short **"Proposed test cases"** list — the regression cases worth filing — and tell the user they can file them with `/qa-tms:case`.

## Severity guidance

- **Critical** — data loss/corruption, auth bypass, PII exposure to unauthorized parties
- **High** — core feature returns wrong results, XSS, crash on a common path
- **Medium** — wrong results on an edge case, misleading counts, broken state on an uncommon path
- **Low** — cosmetic, console noise, minor UX

Judge severity by user impact, not by how hard the bug was to find.
