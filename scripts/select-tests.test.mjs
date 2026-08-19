import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  globToRegExp,
  matchesAny,
  normalisePath,
  pathsMatch,
  parseSpecHeader,
  selectTests,
  renderMarkdown,
} from './select-tests.mjs';

// A spec factory so each test states only the field it cares about.
const spec = (file, over = {}) => ({
  file,
  caseId: null,
  title: null,
  covers: [],
  guardedPaths: [],
  tags: [],
  isSmoke: false,
  ...over,
});

describe('globToRegExp', () => {
  test('* does not cross directory boundaries', () => {
    assert.ok(globToRegExp('server/*.js').test('server/routes.js'));
    assert.ok(!globToRegExp('server/*.js').test('server/nested/routes.js'));
  });

  test('** crosses directory boundaries', () => {
    assert.ok(globToRegExp('client/**/*.jsx').test('client/src/App.jsx'));
    assert.ok(globToRegExp('client/**/*.jsx').test('client/src/deep/nested/App.jsx'));
  });

  test('**/ matches zero directories', () => {
    assert.ok(globToRegExp('**/*.md').test('README.md'));
    assert.ok(globToRegExp('**/*.md').test('docs/guide/setup.md'));
  });

  test('{a,b} alternation', () => {
    const re = globToRegExp('vite.config.{js,ts}');
    assert.ok(re.test('vite.config.js'));
    assert.ok(re.test('vite.config.ts'));
    assert.ok(!re.test('vite.config.mjs'));
  });

  test('dots are literal, not wildcards', () => {
    assert.ok(!globToRegExp('package.json').test('packageXjson'));
  });

  test('? matches exactly one non-separator character', () => {
    assert.ok(globToRegExp('v?.js').test('v1.js'));
    assert.ok(!globToRegExp('v?.js').test('v10.js'));
  });
});

describe('path helpers', () => {
  test('normalisePath strips ./ and leading slashes', () => {
    assert.equal(normalisePath('./server/routes.js'), 'server/routes.js');
    assert.equal(normalisePath('/server/routes.js'), 'server/routes.js');
    assert.equal(normalisePath('  server/routes.js  '), 'server/routes.js');
  });

  test('pathsMatch tolerates the relative prefixes headers actually use', () => {
    assert.ok(pathsMatch('server/routes.js', 'server/routes.js'));
    assert.ok(pathsMatch('server/routes.js', '../server/routes.js'));
    assert.ok(pathsMatch('apps/api/server/routes.js', 'server/routes.js'));
  });

  test('pathsMatch respects segment boundaries', () => {
    // "routes.js" must not match "my-routes.js" just because it is a string suffix.
    assert.ok(!pathsMatch('server/my-routes.js', 'routes.js'));
  });
});

describe('parseSpecHeader', () => {
  const source = `import { test, expect } from '@playwright/test';

/**
 * @qase-id       LOANCRATE-5
 * @qase-url      https://app.qase.io/case/LOANCRATE/5
 * @title         Case sensitivity for borrower search
 * @covers        server/routes.js client/src/App.jsx
 * @preconditions App running with default seed data (60 borrowers; exactly 3 match
 *                "James" — James Smith id 1, James Martin id 40)
 * @guards        BUG-6 — a lowercase query returned zero results because the API
 *                compares with \`.includes(query)\` and never normalises case
 *                (server/routes.js:37-39)
 * @generated-by  qa-tms:codegen
 */
test(
  'LOANCRATE-5 — borrower search matches regardless of query case',
  { tag: ['@qase:LOANCRATE-5', '@regression'] },
  async ({ page }) => {},
);`;

  const parsed = parseSpecHeader(source);

  test('extracts the case id and title', () => {
    assert.equal(parsed.caseId, 'LOANCRATE-5');
    assert.equal(parsed.title, 'Case sensitivity for borrower search');
  });

  test('splits @covers into globs', () => {
    assert.deepEqual(parsed.covers, ['server/routes.js', 'client/src/App.jsx']);
  });

  test('recovers the source path cited in @guards, without the line range', () => {
    assert.ok(parsed.guardedPaths.includes('server/routes.js'));
    assert.ok(!parsed.guardedPaths.some((p) => p.includes(':')));
  });

  test('a wrapped field does not bleed into the next one', () => {
    // The @preconditions value wraps across two lines; @guards must not absorb it.
    assert.ok(!parsed.guardedPaths.some((p) => p.includes('James')));
    assert.equal(parsed.title, 'Case sensitivity for borrower search');
  });

  test('reads Playwright tags', () => {
    assert.deepEqual(parsed.tags, ['@qase:LOANCRATE-5', '@regression']);
    assert.equal(parsed.isSmoke, false);
  });

  test('a spec with no header parses to empty rather than throwing', () => {
    const bare = parseSpecHeader("test('x', async () => {});");
    assert.equal(bare.caseId, null);
    assert.deepEqual(bare.covers, []);
    assert.deepEqual(bare.guardedPaths, []);
  });
});

describe('selectTests', () => {
  const specs = [
    spec('tests/smoke.spec.js', { caseId: 'BOR-1', isSmoke: true, tags: ['@smoke'] }),
    spec('tests/search.spec.js', { caseId: 'BOR-5', covers: ['server/routes.js'] }),
    spec('tests/pagination.spec.js', { caseId: 'BOR-7', guardedPaths: ['client/src/App.jsx'] }),
    spec('tests/credit.spec.js', { caseId: 'BOR-9', covers: ['server/data.js'] }),
  ];

  test('a @covers match selects only that spec, plus smoke', () => {
    const r = selectTests(['server/routes.js'], specs);
    assert.equal(r.mode, 'subset');
    assert.deepEqual(r.specs, ['tests/search.spec.js', 'tests/smoke.spec.js']);
    assert.equal(r.selections.find((s) => s.file === 'tests/search.spec.js').reasons[0].rule, 'covers-glob');
  });

  test('a path cited in @guards selects its spec', () => {
    const r = selectTests(['client/src/App.jsx'], specs);
    assert.equal(r.mode, 'subset');
    assert.ok(r.specs.includes('tests/pagination.spec.js'));
    assert.equal(
      r.selections.find((s) => s.file === 'tests/pagination.spec.js').reasons[0].rule,
      'guards-path',
    );
  });

  test('smoke specs run even when nothing maps to them', () => {
    const r = selectTests(['server/data.js'], specs);
    assert.ok(r.specs.includes('tests/smoke.spec.js'));
    assert.ok(r.specs.includes('tests/credit.spec.js'));
    assert.ok(!r.specs.includes('tests/search.spec.js'));
  });

  test('a changed spec runs itself', () => {
    const r = selectTests(['tests/credit.spec.js'], specs);
    assert.ok(r.specs.includes('tests/credit.spec.js'));
    assert.equal(
      r.selections.find((s) => s.file === 'tests/credit.spec.js').reasons[0].rule,
      'spec-changed',
    );
  });

  test('an unmapped source file escalates to the full suite', () => {
    const r = selectTests(['server/auth.js'], specs);
    assert.equal(r.mode, 'full');
    assert.deepEqual(r.unmapped, ['server/auth.js']);
    assert.equal(r.specs.length, specs.length);
  });

  test('escalation is sticky — one unmapped file overrides confident matches', () => {
    const r = selectTests(['server/routes.js', 'server/auth.js'], specs);
    assert.equal(r.mode, 'full');
    assert.equal(r.specs.length, specs.length);
  });

  test('infra changes escalate to the full suite', () => {
    for (const f of ['package.json', 'playwright.config.js', '.github/workflows/ci.yml']) {
      assert.equal(selectTests([f], specs).mode, 'full', `${f} should escalate`);
    }
  });

  test('docs-only changes never escalate', () => {
    const r = selectTests(['README.md', 'docs/setup.md'], specs);
    assert.equal(r.mode, 'subset');
    assert.deepEqual(r.specs, ['tests/smoke.spec.js']);
    assert.deepEqual(r.ignored, ['README.md', 'docs/setup.md']);
  });

  test('one file matching two specs selects both', () => {
    const shared = [
      spec('tests/a.spec.js', { covers: ['server/**'] }),
      spec('tests/b.spec.js', { covers: ['server/routes.js'] }),
    ];
    const r = selectTests(['server/routes.js'], shared);
    assert.equal(r.mode, 'subset');
    assert.deepEqual(r.specs, ['tests/a.spec.js', 'tests/b.spec.js']);
  });

  test('a spec selected twice records both reasons without duplicating the entry', () => {
    const multi = [spec('tests/a.spec.js', { covers: ['server/routes.js', 'server/data.js'] })];
    const r = selectTests(['server/routes.js', 'server/data.js'], multi);
    assert.equal(r.selections.length, 1);
    assert.equal(r.selections[0].reasons.length, 2);
  });

  test('an empty diff runs only smoke', () => {
    const r = selectTests([], specs);
    assert.equal(r.mode, 'subset');
    assert.deepEqual(r.specs, ['tests/smoke.spec.js']);
  });

  test('no specs at all is reported, not crashed', () => {
    const r = selectTests(['server/routes.js'], []);
    assert.equal(r.totalSpecs, 0);
    assert.deepEqual(r.specs, []);
  });

  test('skipped specs are listed in subset mode and empty in full mode', () => {
    assert.ok(selectTests(['server/routes.js'], specs).skipped.length > 0);
    assert.deepEqual(selectTests(['server/auth.js'], specs).skipped, []);
  });

  test('custom ignore globs are honoured over the defaults', () => {
    const r = selectTests(['server/auth.js'], specs, { ignoreGlobs: ['server/auth.js'] });
    assert.equal(r.mode, 'subset');
  });
});

describe('renderMarkdown', () => {
  const specs = [
    spec('tests/smoke.spec.js', { caseId: 'BOR-1', isSmoke: true }),
    spec('tests/search.spec.js', { caseId: 'BOR-5', covers: ['server/routes.js'] }),
  ];

  test('subset output names each spec and its reason', () => {
    const md = renderMarkdown(selectTests(['server/routes.js'], specs));
    assert.match(md, /Selected 2 of 2 specs/);
    assert.match(md, /tests\/search\.spec\.js/);
    assert.match(md, /`@covers`/);
    assert.match(md, /server\/routes\.js/);
  });

  test('full-suite output explains every escalation', () => {
    const md = renderMarkdown(selectTests(['server/auth.js'], specs));
    assert.match(md, /Running the full suite/);
    assert.match(md, /server\/auth\.js/);
    assert.match(md, /no spec declares coverage/);
    assert.match(md, /How to narrow this next time/);
  });

  test('the no-specs case produces a message rather than an empty table', () => {
    const md = renderMarkdown(selectTests(['server/routes.js'], []));
    assert.match(md, /No specs found/);
  });
});
