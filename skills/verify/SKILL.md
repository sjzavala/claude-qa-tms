---
description: Execute a TMS test case against the running app in a real browser via Playwright MCP, then report a per-step pass/fail verdict with evidence and optionally push the result and a defect back to Qase. Use when asked to verify, execute, or run through a test case manually.
---

# Verify a test case in the browser

Input: **$ARGUMENTS** — one or more case IDs in `<PROJECT>-<n>` form, exactly as Qase displays them (e.g. `ACME-42`, or `ACME-42 ACME-43`). If empty, ask which case, or offer the list from `qql_search`.

## Step 1 — Resolve each ID, then fetch the case

Split each argument on the **last** hyphen. The left side is the project `code`, the right side is the numeric `id` — `qase_get` takes them as two separate params and will not accept the combined string.

| Argument | `code` | `id` |
|---|---|---|
| `<PROJECT>-<n>` | `"<PROJECT>"` | `<n>` |
| e.g. `ACME-42` | `"ACME"` | `42` |

Then `qase_get` with `{entity: "case", code: "<PROJECT>", id: <n>}` per ID. Pass `id` as a **number** — not a quoted string, and never the whole `"<PROJECT>-<n>"` combined form.

Take the project code from the argument itself, not from anything hardcoded here — the examples above are illustrative only.

If an argument is a bare number there is no project code in it. Use the project code already established in this conversation if there is exactly one; otherwise ask rather than guessing.

**Echo what you fetched before executing anything:** one line per case — `<PROJECT>-<n> → "<case title>" (N steps)`. If the title doesn't look like the case the user meant, stop and say so. Silently verifying the wrong case is worse than asking.

Tool names and params: `references/qase-tools.md`. The published Qase README lists names that don't exist on the shipped server — trust that file over memory.

If `qase_get` returns not-found, don't fall through to the local fixture as if nothing happened — say which ID missed, then look for the case in `test-cases/` locally (see `references/local-cases.md`). Same if Qase is unreachable entirely: say so in one line and continue.

## Step 2 — Set up

Confirm the preconditions before executing. If the case says "server running with seed data" and the app isn't up, say so and stop — a fail caused by a missing server is not a finding.

`browser_navigate` to a clean starting state for **each** case. Never let state from a previous case leak into the next one; that's how you manufacture false failures.

## Step 3 — Execute step by step

For each step in the case:

1. Perform the action with the Playwright MCP tools (`browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, …).
2. `browser_snapshot` to observe the resulting state.
3. Compare what you observe against the step's **expected result** — literally. Do not soften a mismatch. If the case says "3 results" and you see 4, that step fails.
4. Record the **actual** observed value, not a paraphrase.

Rules:
- **Do not adjust the steps to make them pass.** If a step can't be performed as written (element missing, label changed), that is itself a result: `blocked`, with a note that the case has drifted from the app.
- Capture `browser_take_screenshot` at the first failing step, and `browser_console_messages` if anything looks wrong.
- Use `browser_network_requests` when the expected result concerns data rather than rendering.

## Step 4 — Verdict

Output a per-step table:

| Step | Action | Expected | Actual | Result |
|------|--------|----------|--------|--------|

Then an overall verdict: **passed** / **failed** / **blocked** / **skipped**.

A case is `failed` if **any** step fails. Report the first failing step as the point of failure and note whether later steps were still executed.

## Step 5 — Push results back (ask first)

Ask before writing to Qase — the user may be mid-demo and not want noise. If they say yes:

- **Prefer `qase_ci_report`.** One call creates the run, records every result, and completes it (`complete: true`). Don't hand-roll the multi-step version unless you need to add results to an existing run.
- Each result must carry the **numeric** `case_id` from Step 1, not the display `<PROJECT>-<n>` form — a result posted with the wrong shape lands in the run detached from its case.
- If you *are* adding to an existing run: `qase_run_upsert` to create/find it, then `qase_result_record` with an array of results — it handles single vs bulk automatically.
- Include the actual-vs-expected text and any stack/console output in the result comment.
- On a genuine product failure, use `qase_triage_defect` — it creates the defect **and** links it to the failed result ids in the same call. Plain `qase_defect_upsert` is for standalone defects.
- Do **not** auto-file a defect for a case that failed because the case itself was wrong or stale. Fix the case instead (`qase_case_upsert` with its `id`).

## Step 6 — Next

If the case passed, offer `/qa-tms:codegen <PROJECT>-<n>` — the same ID you were invoked with — to lock it in as an automated regression test.
If it failed, that's a confirmed bug: write it up with the format in `references/bug-report-template.md`, then still offer codegen — a failing automated test that pins the bug is exactly what you want to hand a developer.
