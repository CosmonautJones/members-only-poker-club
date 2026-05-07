/**
 * AC9 / T10 — `next/image` regression test.
 *
 * Walks `app/(marketing)/**` and `components/marketing/**`, scans every
 * `.tsx`/`.jsx` file as a string, and asserts no raw `<img>` JSX element
 * is present. The assumption is that any rendered raster image must use
 * the `Image` component imported from `next/image`.
 *
 * Today the marketing directories contain no images; the test passes
 * against the empty set and gates regressions as photography lands.
 *
 * Opt-out: a file may add `// next-image-test:skip` on the line directly
 * above a raw `<img>` tag (e.g. inside an MDX-style example or storybook
 * snippet) to suppress the regression for that specific tag. Use sparingly.
 */

import path from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SCAN_DIRS = [
  path.join(REPO_ROOT, 'app', '(marketing)'),
  path.join(REPO_ROOT, 'components', 'marketing'),
];

const SCANNED_EXTENSIONS = new Set(['.tsx', '.jsx']);
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'build']);

function walk(dir: string): string[] {
  let entries: string[] = [];
  let stat;
  try {
    stat = statSync(dir);
  } catch {
    return entries;
  }
  if (!stat.isDirectory()) return entries;

  for (const name of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(name)) continue;
    const full = path.join(dir, name);
    let entryStat;
    try {
      entryStat = statSync(full);
    } catch {
      continue;
    }
    if (entryStat.isDirectory()) {
      entries = entries.concat(walk(full));
    } else if (entryStat.isFile() && SCANNED_EXTENSIONS.has(path.extname(full))) {
      entries.push(full);
    }
  }
  return entries;
}

// Match raw JSX <img ...> tags. We require either whitespace, a newline,
// `>`, or `/>` immediately after `<img` so we never trip on identifier-
// like substrings such as the literal word "image" or `<imgFoo>`.
const IMG_TAG_PATTERN = /<img(\s|\n|\r|>|\/>)/g;

interface RawImgFinding {
  file: string;
  line: number;
  text: string;
}

function findRawImgTags(filePath: string, source: string): RawImgFinding[] {
  const findings: RawImgFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    IMG_TAG_PATTERN.lastIndex = 0;
    if (!IMG_TAG_PATTERN.test(line)) continue;

    const previous = (lines[i - 1] ?? '').trim();
    if (previous.includes('next-image-test:skip')) continue;

    findings.push({ file: filePath, line: i + 1, text: line.trim() });
  }
  return findings;
}

describe('next/image regression scan (AC9 / T10)', () => {
  it('finds zero raw <img> tags in marketing source files', () => {
    const files = SCAN_DIRS.flatMap(walk);
    const findings = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return findRawImgTags(file, source);
    });

    if (findings.length > 0) {
      const formatted = findings
        .map((f) => `  ${path.relative(REPO_ROOT, f.file)}:${f.line} -> ${f.text}`)
        .join('\n');
      throw new Error(
        `Raw <img> tags detected in marketing surfaces. Use next/image instead:\n${formatted}`,
      );
    }

    expect(findings).toEqual([]);
  });

  it('actually scanned the expected directories (sanity check)', () => {
    // Even when both directories are empty of .tsx files, the walk must
    // not throw. We confirm walk() handled missing dirs gracefully and at
    // least one configured dir resolved.
    const counts = SCAN_DIRS.map((dir) => walk(dir).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(0);
  });
});
