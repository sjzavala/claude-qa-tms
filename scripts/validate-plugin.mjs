#!/usr/bin/env node
/**
 * validate-plugin — structural checks on the qa-tms plugin itself.
 *
 * A skills plugin fails silently: a malformed SKILL.md frontmatter or a reference path
 * that no longer resolves does not throw, it just makes Claude quietly worse at the task.
 * These checks turn that class of rot into a red build.
 *
 * Zero dependencies. Exits non-zero on the first category with failures.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];
const checks = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const ok = (msg) => checks.push(msg);

// --- plugin manifest -------------------------------------------------------

const manifestPath = join(ROOT, '.claude-plugin/plugin.json');
let manifest = null;
if (!existsSync(manifestPath)) {
  fail('.claude-plugin/plugin.json is missing');
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    ok('plugin.json parses');
    for (const field of ['name', 'description', 'version']) {
      if (!manifest[field]) fail(`plugin.json is missing "${field}"`);
    }
    if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      fail(`plugin.json version "${manifest.version}" is not semver`);
    }
    if (manifest.name && !/^[a-z0-9-]+$/.test(manifest.name)) {
      fail(`plugin.json name "${manifest.name}" must be lowercase kebab-case`);
    }
  } catch (e) {
    fail(`plugin.json is not valid JSON: ${e.message}`);
  }
}

// --- skills ----------------------------------------------------------------

const skillsDir = join(ROOT, 'skills');
if (!existsSync(skillsDir)) {
  fail('skills/ directory is missing');
} else {
  const skillNames = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());

  if (skillNames.length === 0) fail('skills/ contains no skills');

  for (const name of skillNames) {
    const skillPath = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(skillPath)) {
      fail(`skills/${name}/ has no SKILL.md`);
      continue;
    }

    const source = readFileSync(skillPath, 'utf8');
    const fm = source.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      fail(`skills/${name}/SKILL.md has no YAML frontmatter`);
      continue;
    }

    const description = fm[1].match(/^description:\s*(.+)$/m);
    if (!description) {
      fail(`skills/${name}/SKILL.md frontmatter has no "description"`);
    } else {
      // The description is the only thing the model sees when deciding whether to load
      // the skill. A vague one-liner is a silent routing failure.
      const text = description[1].trim();
      if (text.length < 40) {
        fail(`skills/${name}/SKILL.md description is too short to route on (${text.length} chars)`);
      }
      if (!/\bUse when\b/i.test(text)) {
        warn(`skills/${name}/SKILL.md description has no "Use when ..." trigger clause`);
      }
    }

    if (!/^#\s+\S/m.test(source)) warn(`skills/${name}/SKILL.md has no H1 heading`);

    // Every references/*.md path named in a skill must resolve.
    for (const m of source.matchAll(/references\/[\w-]+\.md/g)) {
      if (!existsSync(join(ROOT, m[0]))) {
        fail(`skills/${name}/SKILL.md points at ${m[0]}, which does not exist`);
      }
    }

    ok(`skills/${name}/SKILL.md`);
  }
}

// --- references ------------------------------------------------------------

const referencesDir = join(ROOT, 'references');
if (existsSync(referencesDir)) {
  const referenced = new Set();
  const scan = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) scan(full);
      else if (entry.endsWith('.md')) {
        for (const m of readFileSync(full, 'utf8').matchAll(/references\/([\w-]+\.md)/g)) {
          referenced.add(m[1]);
        }
      }
    }
  };
  scan(ROOT);

  for (const file of readdirSync(referencesDir).filter((f) => f.endsWith('.md'))) {
    if (!referenced.has(file)) warn(`references/${file} is not referenced by any skill or the README`);
  }
  ok(`references/ (${readdirSync(referencesDir).filter((f) => f.endsWith('.md')).length} files)`);
}

// --- no credentials --------------------------------------------------------

const SECRET_PATTERNS = [
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API key'],
  [/QASE_API_TOKEN\s*[:=]\s*["'][^"'$][^"']*["']/, 'hardcoded Qase token'],
];

/** Setup docs legitimately show the shape of a token. Don't cry wolf over a placeholder. */
const PLACEHOLDER = /your_?token|<[^>]+>|xxx+|changeme|placeholder|example|\.\.\./i;

const scanForSecrets = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) scanForSecrets(full);
    else if (/\.(md|json|mjs|js|yml|yaml)$/.test(entry)) {
      const content = readFileSync(full, 'utf8');
      for (const [pattern, label] of SECRET_PATTERNS) {
        const hit = content.match(pattern);
        if (hit && !PLACEHOLDER.test(hit[0])) {
          fail(`possible ${label} committed in ${full.replace(`${ROOT}/`, '')}`);
        }
      }
    }
  }
};
scanForSecrets(ROOT);
ok('no credentials in tracked files');

// --- report ----------------------------------------------------------------

for (const c of checks) console.log(`  ✓ ${c}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);

console.log(
  `\n${checks.length} passed, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}, ${errors.length} error${errors.length === 1 ? '' : 's'}`,
);

process.exit(errors.length > 0 ? 1 : 0);
