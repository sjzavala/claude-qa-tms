# qa-tms

A Claude Code plugin for the TMS-driven QA loop:

```
explore  →  file cases  →  verify in a browser  →  generate traceable specs
```

| Skill | What it does |
|---|---|
| `/qa-tms:explore <url>` | Reads the code to form hypotheses, then drives a real browser via Playwright MCP to hunt bugs. Outputs a ranked findings list in bug-report format. |
| `/qa-tms:case [findings]` | Creates test cases in Qase (or `test-cases/` locally). Prints the case IDs. |
| `/qa-tms:verify <PROJECT>-<n> [...]` | Executes a case step-by-step in the browser, per-step actual-vs-expected verdict, optionally pushes results + defects to Qase. |
| `/qa-tms:codegen <PROJECT>-<n> [...]` | Generates a Playwright spec with a JSDoc header + `@qase:<PROJECT>-<n>` tag tracing back to the case. Runs it and reports the real result. |

## Case IDs

`verify` and `codegen` take case IDs in **`<PROJECT>-<n>` form, exactly as Qase displays them** — the whole ID, not the bare number. This matters when you author cases by hand in the Qase web UI: whatever the case page shows is what you type, and it's what pins the loop to that one case.

Both skills split the argument on the last hyphen to reach the two params `qase_get` actually wants:

| You type | `code` | `id` |
|---|---|---|
| `<PROJECT>-<n>` | `"<PROJECT>"` | `<n>` (number) |
| e.g. `ACME-42` | `"ACME"` | `42` |

`verify` echoes back `<PROJECT>-<n> → "<case title>" (N steps)` before it touches the browser, so a wrong ID surfaces as a mismatched title rather than a confusing run. A bare number works only when the project code is already unambiguous in the conversation; otherwise you'll be asked.

Both forms survive into the generated spec — display form in `@qase-id` and the `@qase:<PROJECT>-<n>` tag, split form in `@qase-url`, numeric in `qase.id()`.

## Setup

**1. Qase account** (free tier: 4 users, 2 projects, unlimited test cases, API included)

- Sign up at <https://app.qase.io>
- Create a project, note its **code** (e.g. `BOR`)
- API token: **Settings → API tokens → Create token**

**2. Export the token** in `~/.zshenv` — **not** `~/.zshrc`:

```bash
echo 'export QASE_API_TOKEN="your_token_here"' >> ~/.zshenv && chmod 600 ~/.zshenv
```

`~/.zshenv` is sourced by *every* zsh invocation. `~/.zshrc` is sourced only by
**interactive** shells, so an MCP server spawned non-interactively — which is what
happens under a GUI-launched IDE — would never see the token. The failure is silent and
easy to misread: `qase_project_context` swallows the resulting 401 and returns an
all-null payload, which looks like an empty project rather than broken auth.

**That same all-null payload also means "project does not exist."** Verified 2026-08-03:
`qase_project_context` on a deleted project returned `project: null, suites: null,
milestones: null, environments: null` while still returning the `users` block, which is
indistinguishable at a glance from the 401 case. Don't start debugging the token on that
signal alone — tell the two apart first:

```bash
# token bad  -> HTTP 401.   token fine -> HTTP 200 plus the list of projects you really have.
zsh -lc 'curl -s -o /dev/null -w "%{http_code}\n" -H "Token: $QASE_API_TOKEN" https://api.qase.io/v1/project'
```

If that prints `200`, the token is fine and the project code is the problem. Note the
codes are case-sensitive and must match exactly what `/v1/project` returns.

The plugin's `.mcp.json` launches the server via `zsh -c`, so it sources `~/.zshenv`
itself rather than depending on what Claude Code inherited at launch. The token is never
written into the plugin.

Verify it the way the server sees it (prints `token ok`, never the token):

```bash
zsh -c 'echo ${QASE_API_TOKEN:+token ok}'
```

**3. Pre-warm the npx cache** so the MCP server doesn't cold-start when you need it:

```bash
npx -y @qase/mcp-server@2.0.0 --help
```

**4. Verify** — start Claude Code and run `/mcp`. You should see both `qase` and `playwright` connected.

## Offline fallback

Every skill degrades gracefully. If Qase is unreachable or the token is missing, cases are read from and written to `test-cases/*.md` in the repo (format: `references/local-cases.md`). The loop keeps working; only the hosted UI is lost. Nothing here requires debugging MCP config mid-session.

## Requirements

- Playwright MCP configured (user-scoped is fine — this plugin does not bundle it to avoid duplicate tools)
- Node 20+

## Layout

```
qa-tms/
├── .claude-plugin/plugin.json
├── .mcp.json                      # qase MCP server, token from env
├── skills/{explore,case,verify,codegen}/SKILL.md
└── references/
    ├── qase-tools.md              # authoritative MCP tool names (the vendor README is wrong)
    ├── bug-report-template.md     # bug report format + rules
    ├── spec-template.md           # JSDoc traceability header
    └── local-cases.md             # offline case format
```

## Known gotcha

The published Qase README documents tool names that **do not exist** on the shipped
`@qase/mcp-server@2.0.0` — `qase_get_entity`, `qase_run_create`, `qase_result_upsert`,
`qase_defect_create`, `qase_suite_create`, `qase_run_complete`. The real names are in
`references/qase-tools.md`, probed from the server's own `tools/list`. Only 13 core tools
are exposed by default; the rest need `qase_discover_tools` or the `qase_api` escape hatch.

Edit any `SKILL.md` and run `/reload-plugins` to pick up changes without restarting.
