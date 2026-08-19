#!/usr/bin/env node
/**
 * select-tests — map a set of changed files to the Playwright specs that guard them.
 *
 * The join key is the traceability header that `qa-tms:codegen` writes into every spec
 * (see references/spec-template.md). A spec declares what it covers two ways:
 *
 *   @covers  server/routes.js client/src/App.jsx     explicit globs, authoritative
 *   @guards  BUG-6 — ... (server/routes.js:37-39)    prose, but the cited path counts
 *
 * Selection is deliberately conservative: anything this script cannot explain, it
 * escalates to the full suite. A runner that silently skips the one test that mattered
 * is worse than no runner, so "I don't know" always means "run everything".
 *
 * Zero dependencies — runs on a bare Node 20 with no install step.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SPEC_PATTERN = /\.(spec|test)\.(js|mjs|cjs|ts|tsx|jsx)$/;

/** Changes that invalidate any assumption about which tests are relevant. */
const DEFAULT_INFRA_GLOBS = [
  'playwright.config.*',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig*.json',
  'vite.config.*',
  '.github/workflows/**',
  '**/fixtures/**',
  '**/*.fixture.*',
];

/** Changes that cannot affect runtime behaviour at all. */
const DEFAULT_IGNORE_GLOBS = ['**/*.md', 'LICENSE', '.gitignore', '.editorconfig', 'docs/**'];

// ---------------------------------------------------------------------------
// glob matching
// ---------------------------------------------------------------------------

/**
 * Convert a glob to a RegExp. Supports **, *, ?, and {a,b} alternation.
 * `**` crosses directory boundaries; `*` and `?` never do.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` may match zero directories, so the trailing slash is part of the group.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        re += '\\{';
      } else {
        const alts = glob.slice(i + 1, close).split(',');
        re += `(?:${alts.map(escapeRegExp).join('|')})`;
        i = close;
      }
    } else {
      re += escapeRegExp(c);
    }
  }
  return new RegExp(`^${re}$`);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

/** Normalise to repo-root-relative, forward-slashed, no leading `./`. */
export function normalisePath(p) {
  return p.trim().split(sep).join('/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Two paths refer to the same file if one is a suffix of the other on a segment
 * boundary. Headers cite paths relative to wherever the author was standing
 * (`server/routes.js`, `../server/routes.js`), so exact equality is too strict.
 */
export function pathsMatch(a, b) {
  const x = normalisePath(a).replace(/^(\.\.\/)+/, '');
  const y = normalisePath(b).replace(/^(\.\.\/)+/, '');
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

// ---------------------------------------------------------------------------
// spec parsing
// ---------------------------------------------------------------------------

export function findSpecs(testDir, repoRoot = process.cwd()) {
  const abs = join(repoRoot, testDir);
  if (!existsSync(abs)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (SPEC_PATTERN.test(entry)) out.push(normalisePath(relative(repoRoot, full)));
    }
  };
  walk(abs);
  return out.sort();
}

/**
 * Pull the traceability fields out of a spec's first JSDoc block.
 *
 * Fields continue across lines until the next `@key`, matching how the template wraps
 * long @preconditions and @guards values.
 */
export function parseSpecHeader(source) {
  const block = source.match(/\/\*\*([\s\S]*?)\*\//);
  const fields = {};
  if (block) {
    const lines = block[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, ''));
    let current = null;
    for (const line of lines) {
      const m = line.match(/^\s*@([\w-]+)\s*(.*)$/);
      if (m) {
        current = m[1];
        fields[current] = fields[current] ? `${fields[current]} ${m[2]}` : m[2];
      } else if (current && line.trim()) {
        fields[current] += ` ${line.trim()}`;
      }
    }
  }

  const covers = (fields.covers || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Paths cited anywhere in @guards, with any :line or :line-range suffix dropped.
  const guardedPaths = [];
  const guardText = fields.guards || '';
  const pathRe = /((?:\.\.\/)*[\w.-]+(?:\/[\w.-]+)+\.\w+)(?::\d+(?:-\d+)?)?/g;
  let match;
  while ((match = pathRe.exec(guardText)) !== null) guardedPaths.push(match[1]);

  const tags = [...source.matchAll(/tag:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((t) => t[1]));

  return {
    caseId: (fields['qase-id'] || '').trim() || null,
    title: (fields.title || '').trim() || null,
    covers,
    guardedPaths,
    tags,
    isSmoke: tags.includes('@smoke'),
  };
}

export function loadSpecs(testDir, repoRoot = process.cwd()) {
  return findSpecs(testDir, repoRoot).map((file) => ({
    file,
    ...parseSpecHeader(readFileSync(join(repoRoot, file), 'utf8')),
  }));
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

/**
 * Decide which specs to run.
 *
 * Rules are applied in order and every pick records why it was picked, so the PR
 * comment can defend the decision. Escalation to the full suite is sticky: once any
 * rule demands it, no later rule can narrow it back down.
 */
export function selectTests(changedFiles, specs, options = {}) {
  const infraGlobs = options.infraGlobs ?? DEFAULT_INFRA_GLOBS;
  const ignoreGlobs = options.ignoreGlobs ?? DEFAULT_IGNORE_GLOBS;

  const changed = changedFiles.map(normalisePath).filter(Boolean);
  const selections = [];
  const unmapped = [];
  const escalations = [];

  const select = (spec, rule, trigger) => {
    const existing = selections.find((s) => s.file === spec.file);
    if (existing) {
      if (!existing.reasons.some((r) => r.rule === rule && r.trigger === trigger)) {
        existing.reasons.push({ rule, trigger });
      }
      return;
    }
    selections.push({
      file: spec.file,
      caseId: spec.caseId,
      title: spec.title,
      reasons: [{ rule, trigger }],
    });
  };

  const relevant = changed.filter((f) => !matchesAny(f, ignoreGlobs));
  const ignored = changed.filter((f) => matchesAny(f, ignoreGlobs));

  // Rule: a spec tagged @smoke runs on every PR, whatever changed.
  for (const spec of specs.filter((s) => s.isSmoke)) select(spec, 'smoke', 'always runs');

  for (const file of relevant) {
    // Rule: infra change invalidates the whole map.
    if (matchesAny(file, infraGlobs)) {
      escalations.push({ file, why: 'test infrastructure or dependencies changed' });
      continue;
    }

    // Rule: a changed spec always runs itself.
    const self = specs.find((s) => s.file === file);
    if (self) {
      select(self, 'spec-changed', file);
      continue;
    }

    // Rule: @covers glob, then a path cited in @guards.
    let mapped = false;
    for (const spec of specs) {
      if (spec.covers.length && matchesAny(file, spec.covers)) {
        select(spec, 'covers-glob', file);
        mapped = true;
      } else if (spec.guardedPaths.some((p) => pathsMatch(file, p))) {
        select(spec, 'guards-path', file);
        mapped = true;
      }
    }

    // Rule: a source change no spec claims is exactly the blind spot that makes
    // narrowing unsafe. Escalate rather than guess.
    if (!mapped) {
      unmapped.push(file);
      escalations.push({ file, why: 'no spec declares coverage of this file' });
    }
  }

  const mode = escalations.length > 0 ? 'full' : 'subset';
  const selectedFiles = selections.map((s) => s.file).sort();
  const skipped = specs
    .filter((s) => !selectedFiles.includes(s.file))
    .map((s) => ({ file: s.file, caseId: s.caseId, title: s.title }));

  return {
    mode,
    specs: mode === 'full' ? specs.map((s) => s.file).sort() : selectedFiles,
    caseIds: (mode === 'full' ? specs : selections).map((s) => s.caseId).filter(Boolean),
    selections,
    skipped: mode === 'full' ? [] : skipped,
    unmapped,
    escalations,
    ignored,
    totalSpecs: specs.length,
  };
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

const RULE_LABEL = {
  'spec-changed': 'the spec itself changed',
  'covers-glob': 'declared in `@covers`',
  'guards-path': 'cited in `@guards`',
  smoke: 'tagged `@smoke`',
};

export function renderMarkdown(result) {
  const lines = ['## 🧪 Intelligent runner'];

  if (result.totalSpecs === 0) {
    lines.push('', 'No specs found. Nothing to select.');
    return lines.join('\n');
  }

  if (result.mode === 'full') {
    lines.push(
      '',
      `**Running the full suite** — ${result.totalSpecs} spec${result.totalSpecs === 1 ? '' : 's'}.`,
      '',
      'Narrowing was unsafe because:',
      '',
      ...result.escalations.map((e) => `- \`${e.file}\` — ${e.why}`),
    );
    if (result.unmapped.length) {
      lines.push(
        '',
        '<details><summary>How to narrow this next time</summary>',
        '',
        'Add a `@covers` line to the spec that guards each file above, e.g.',
        '',
        '```js',
        ' * @covers       server/routes.js client/src/App.jsx',
        '```',
        '',
        'The runner picks it up on the next push — no config to maintain.',
        '</details>',
      );
    }
    return lines.join('\n');
  }

  const n = result.selections.length;
  lines.push(
    '',
    `**Selected ${n} of ${result.totalSpecs} spec${result.totalSpecs === 1 ? '' : 's'}.**`,
    '',
    '| Spec | Case | Why it was selected |',
    '|---|---|---|',
    ...result.selections.map((s) => {
      const why = s.reasons
        .map((r) => (r.rule === 'smoke' ? RULE_LABEL.smoke : `${RULE_LABEL[r.rule]} → \`${r.trigger}\``))
        .join('<br>');
      return `| \`${s.file}\` | ${s.caseId ?? '—'} | ${why} |`;
    }),
  );

  if (result.skipped.length) {
    lines.push(
      '',
      `<details><summary>Skipped ${result.skipped.length} spec${result.skipped.length === 1 ? '' : 's'}</summary>`,
      '',
      ...result.skipped.map((s) => `- \`${s.file}\`${s.caseId ? ` (${s.caseId})` : ''}`),
      '</details>',
    );
  }

  if (result.ignored.length) {
    lines.push(
      '',
      `<sub>${result.ignored.length} changed file${result.ignored.length === 1 ? '' : 's'} ignored as non-behavioural (docs, config comments).</sub>`,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function readChangedFiles(args) {
  if (args['changed-file']) {
    return readFileSync(args['changed-file'], 'utf8').split('\n').filter(Boolean);
  }
  if (args.changed) {
    return String(args.changed).split(/[\n,]/).filter(Boolean);
  }
  return [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args['repo-root'] || process.cwd();
  const testDir = args['test-dir'] || 'tests';

  let options = {};
  const configPath = join(repoRoot, args.config || '.qa-tms/selection.json');
  if (existsSync(configPath)) options = JSON.parse(readFileSync(configPath, 'utf8'));

  const specs = loadSpecs(testDir, repoRoot);
  const result = selectTests(readChangedFiles(args), specs, options);

  if (args['out-json']) writeFileSync(args['out-json'], JSON.stringify(result, null, 2));
  if (args['out-markdown']) writeFileSync(args['out-markdown'], renderMarkdown(result));

  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `mode=${result.mode}`,
        `spec-args=${result.specs.join(' ')}`,
        `selected-count=${result.mode === 'full' ? result.totalSpecs : result.selections.length}`,
        `total-count=${result.totalSpecs}`,
        '',
      ].join('\n'),
      { flag: 'a' },
    );
  }

  if (!args['out-json'] && !args['out-markdown']) console.log(JSON.stringify(result, null, 2));
  else console.log(renderMarkdown(result));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
