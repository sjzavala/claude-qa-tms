# Qase MCP tool reference

Authoritative list, probed from `@qase/mcp-server@2.0.0` via `tools/list`. The published
README documents *different* names (`qase_get_entity`, `qase_run_create`,
`qase_result_upsert`, `qase_defect_create`, `qase_suite_create`, `qase_run_complete`) —
**those do not exist on the shipped server.** Use the names below.

Only 13 core tools are exposed by default. Others (deletions, milestones, suites, plans,
attachments, environments, shared steps) must be activated on demand with
`qase_discover_tools`, or reached via the `qase_api` escape hatch.

**Almost every tool takes `code`** — the project code, e.g. `LOANCRATE`. Pass it every time.

## Core tools

| Tool | Purpose | Key params |
|---|---|---|
| `qase_project_context` | Project details, suites tree, milestones, environments, custom fields, users — in one call. Cached 5 min. **Call this first.** | `code` |
| `qase_get` | Fetch any entity by type + ID | `entity`, `code`, `id`, `fields` |
| `qql_search` | Query entities with Qase Query Language | `query`, `limit`, `offset` |
| `qql_help` | QQL syntax help and examples | `topic` |
| `qase_case_upsert` | Create (no `id`) or update (with `id`) a test case | `code`, `id`, `title`, `description`, `preconditions`, `postconditions`, `severity`, `priority`, `type`, `layer`, `behavior`, `automation`, `status`, `is_flaky` |
| `qase_run_upsert` | Create or update a test run | `code`, `id`, `title`, `description`, `environment_id`, `milestone_id`, `plan_id`, `cases`, `tags`, `is_autotest`, `start_time`, `end_time` |
| `qase_result_record` | Record one **or many** results into a run — pass an array, it picks single vs bulk API automatically | `code`, `run_id`, `results` |
| `qase_defect_upsert` | Create or update a defect. `status: "resolved"` to resolve | `code`, `id`, `title`, `actual_result`, `severity`, `status`, `tags`, `attachments` |
| `qase_ci_report` | **Run + results + complete in one call.** Replaces the 3–4 step manual workflow | `code`, `title`, `environment_id`, `results`, `complete`, `is_autotest` |
| `qase_triage_defect` | Create a defect from a test failure and link it to the failed results | `code`, `title`, `severity`, `actual_result`, `description`, `run_id`, `failed_result_ids`, `tags` |
| `qase_regression_run` | Set up a regression run from suite IDs, case IDs, or a plan | `code`, `title`, `plan_id`, `suite_ids`, `include_cases` |
| `qase_discover_tools` | Search for and **activate** additional tools not exposed by default | `query`, `category`, `activate` |
| `qase_api` | Direct REST call for anything uncovered | `method`, `path` (starts `/v1/`), `body`, `query` |

## Field values that aren't obvious

Enum fields accept **either** a label or a numeric ID — the server normalizes, so prefer labels.

- `priority`: `high` | `medium` | `low` (0=not set, 1=high, 2=medium, 3=low)
- `severity`: `blocker` | `critical` | `major` | `normal` | `minor` | `trivial` | `undefined`
- `automation`: `Manual` (0) | `To be automated` (1) | `Automated` (2) — set to `Automated` after `/qa-tms:codegen` ships a spec
- `steps`: array of `{action, expected_result, data?}`; `steps_type` is `classic` (default) or `gherkin`. Substeps nest under `steps`.
- `defect.status`: `open` | `in_progress` | `resolved` | `invalid`
- Project `code` must match `^[A-Z0-9_]+$`, 2–10 chars.

## Shortcuts worth preferring

- **Submitting results?** Use `qase_ci_report` — one call creates the run, records every
  result, and completes it. Don't hand-roll `qase_run_upsert` → `qase_result_record`.
- **A test failed and it's a real product bug?** Use `qase_triage_defect`, not
  `qase_defect_upsert` — it links the defect to the failing results in the same call.
- **Need a suite created?** Not in the core set. `qase_discover_tools` with
  `{query: "suite", activate: true}`, or `qase_api` with
  `POST /v1/suite/{code}`.

## Environment

`QASE_API_TOKEN` is read from the environment by the plugin's `.mcp.json`. Optional:
`QASE_HOST` (self-hosted instances), `QASE_MODE`.

Sanity check outside of MCP:

```bash
curl -s -H "Token: $QASE_API_TOKEN" "https://api.qase.io/v1/project?limit=20"
```
