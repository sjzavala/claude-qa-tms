---
description: Create or update test cases in the Qase TMS (with a local-markdown fallback when Qase is unavailable). Use when asked to file test cases, write up regression cases from bug findings, or turn a described flow or an existing spec file into managed test cases.
---

# File test cases in the TMS

Input: **$ARGUMENTS** — may be findings from a prior `/qa-tms:explore` run, a described flow, a path to a spec file, or empty (then use the findings already in this conversation).

## Step 0 — Pick the backend

Try Qase first. If the `qase` MCP tools are unavailable, or the first call errors on auth, **do not stop and do not debug the connection** — say one line ("Qase unreachable, writing cases locally to `test-cases/`") and switch to the local fallback in `references/local-cases.md`. Mention it once; don't re-litigate it later.

## Step 1 — Establish project context

Call `qase_project_context` with the project `code` once — it returns the suites tree, milestones, environments, custom fields, and users in a single call, cached for 5 minutes. Cache that in your head for the rest of the session; don't re-fetch per case.

No project code is hardcoded. Take it from the conversation if it's already unambiguous; otherwise ask which project to use **once**, then proceed. If you always work in one project, set it as the default here.

Exact tool names and params are in `references/qase-tools.md` — the published Qase README lists names that don't exist on the shipped server, so use that file, not your memory.

## Step 2 — Shape the cases

Before writing anything, decide the case list. Good cases for a regression suite:

- **One behavior per case.** If the title needs "and", it's two cases.
- **Every confirmed bug gets a case that fails today.** That's the regression guard — it's the whole point.
- **Add the happy path for anything you found a bug in.** A test that only covers the bug lets a fix break the normal case silently.
- **Boundary cases get explicit values** in the title: "Credit score filter includes borrowers at exactly the minimum (700)".
- Skip cases you cannot deterministically automate later (timing-dependent, requires manual visual judgment) unless you mark them `is_manual`.

## Step 3 — Write each case

Map to Qase fields via `qase_case_upsert`:

| Qase field | Content |
|---|---|
| `title` | Behavior-first, states expected outcome. "Search by last name is case-insensitive" — not "Test search". |
| `suite_id` | Group by feature area. Suite creation is not a core tool — use `qase_discover_tools` with `{query: "suite", activate: true}`, or `qase_api` with `POST /v1/suite/{code}`. |
| `severity` / `priority` | Match the bug's user impact. Regression guards for High/Critical bugs are `high` priority. |
| `preconditions` | Server URL, seed data state, auth state. Anything the test assumes. |
| `steps` | Each step has three fields in this order: `action`, `data`, `expected_result` — that's how Qase renders it and how a tester reads it (*do this, with this input, see this*). Put the literal input in `data` rather than burying it in the action sentence; leave `data` empty for steps that take no input. The expected result must be **observable** — a visible value, count, or element state. |
| `description` | For a regression case, link the bug: what was broken, and the file:line if known. |
| `custom_field` / tags | Tag regression guards (e.g. `regression`, `bug-guard`) so they're filterable later. |

Steps must be executable by someone who has never seen the app. "Search for `smith`" not "perform a search".

## Step 4 — Create them

Use `qase_case_upsert` per case. Prefer a handful of well-formed cases over a large batch of thin ones.

After creation, report a table so the IDs are visible and copyable:

| Case ID | Title | Suite | Guards |
|---------|-------|-------|--------|
| `BOR-12` | Search by last name is case-insensitive | Borrower Search | BUG-3 |

The **Case ID** column is what `/qa-tms:verify` and `/qa-tms:codegen` consume — always print it.

## Step 5 — Offer the next step

End with the concrete next commands, e.g.:

```
/qa-tms:verify BOR-12       # execute it in a real browser
/qa-tms:codegen BOR-12      # generate the Playwright spec
```

## Notes

- **Never invent a case ID.** If a create call fails, say so and report which cases did land.
- Updating an existing case is `qase_case_upsert` **with** the `id` — use it rather than creating a near-duplicate.
- If the user asks to file a **defect** (a bug record) rather than a test case, that's `qase_defect_upsert`. Cases describe intended behavior; defects describe a broken instance of it. File both when a bug is confirmed.
