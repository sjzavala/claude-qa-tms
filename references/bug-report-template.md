# Bug report format

One block per finding. Keep it tight — a reviewer should be able to reproduce without asking a follow-up question.

```markdown
### BUG-<n>: <one-line summary, states the wrong behavior, not the fix>

**Severity:** Critical | High | Medium | Low
**Area:** <feature / endpoint / component>
**Environment:** <base URL, browser, commit or branch>

**Steps to reproduce**
1. <exact, minimal, from a clean page load>
2. <include literal input values in backticks>
3. ...

**Expected**
<what a reasonable user or the spec would require>

**Actual**
<what happens, with the concrete observed value>

**Evidence**
<screenshot reference, response body excerpt, console error, or network sequence>

**Suspected cause**
`path/to/file.js:LINE` — <one sentence on the mechanism>

**Scope & impact**
<who hits this, how often, what it breaks downstream, whether data is affected>
```

## Rules

- **Expected vs Actual must be different sentences.** "Expected: it works / Actual: it doesn't" is not a bug report.
- **Literal values, not descriptions.** `smith ` (trailing space) beats "a search term with whitespace".
- **Minimal repro.** If step 3 isn't needed to trigger it, delete step 3.
- **Separate bugs get separate reports**, even if they share a root cause — note the shared cause in each.
- **Impact is about users, not code.** "Users on page 2+ never see one borrower per page, so a search that should surface a match can silently miss it" beats "off-by-one in slice()".
- Don't propose the fix in the report body. If you have a strong opinion, add it as a trailing `**Suggested fix:**` line so it's clearly separable from the observation.
