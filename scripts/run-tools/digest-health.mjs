#!/usr/bin/env node
/**
 * digest-health.mjs — mechanical health-metric computation for /digest.
 *
 * Replaces the "eyeball the ratio" prose claim in `.claude/skills/digest/SKILL.md`
 * §Health metric with a callable function that reads the learnings inbox,
 * classifies each PROCESSED entry by its `processed_into:` frontmatter
 * content, and reports the binding ratio.
 *
 * Categories (mapped from `processed_into:` substring matches, in priority order):
 *   new-test     → contains  "tests/"   or "test:" or ".test."
 *   new-tool     → contains  "scripts/" or "tool:" or "lib/"
 *   new-skill    → contains  ".claude/skills/" or "skill:"
 *   kb-archive   → contains  "docs/kb/" or "kb:"
 *   drop         → starts with "drop" (case-insensitive)
 *   surface      → contains  "surfaced" or "surface to user" (any case)
 *   unknown      → didn't match any of the above
 *
 * Binding ratio = (new-test + new-tool) / (total_processed - drop - surface)
 *   - drop and surface are EXCLUDED from the denominator because they
 *     produce no artifact at all (drop) or the artifact lives outside
 *     /digest's control (surface)
 *   - new-skill and kb-archive ARE in the denominator because they ARE
 *     applied outcomes, just less behavior-binding than tests/tools
 *
 * Threshold: 0.5 (per /digest SKILL.md §Health metric — "should be >50%").
 *   - healthy = binding_ratio > 0.5
 *   - if denominator is 0 (everything was drop/surface), healthy = null
 *     (no opinion — there's nothing to bind against)
 *
 * Usage:
 *   node scripts/run-tools/digest-health.mjs [--dir <inbox-dir>]
 *
 * Default --dir is `learnings/inbox/` relative to the current working
 * directory. The tool exits 0 always (healthy is a value, not an exit code —
 * /digest decides how to react to the result).
 *
 * Output: single JSON object on stdout.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'learnings/inbox' },
  },
});

const inboxDir = resolve(process.cwd(), values.dir);

/**
 * Extract YAML frontmatter as a flat object. Naive parser — handles only the
 * `key: value` shape the inbox-write.sh script emits. No nested objects, no
 * arrays. If frontmatter is missing/malformed, returns null.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const block = match[1];
  const out = {};
  for (const line of block.split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/**
 * Classify a `processed_into:` value into one of the seven categories.
 *
 * Strategy: drop + surface are checked first (those are status markers,
 * not artifacts). For path-based outcomes, we use TEXT-POSITION priority:
 * whichever artifact pattern appears FIRST in the processed_into text wins.
 * Rationale: /digest's processed_into convention puts the primary artifact
 * first; supporting amendments come after. This avoids mis-classifying a
 * new-tool entry as new-skill just because the tool's SKILL.md was updated
 * as a doc amendment alongside the primary script.
 */
function classify(processedInto) {
  if (!processedInto) return 'unknown';
  const lower = processedInto.toLowerCase();

  // Status markers — checked first because they may co-mention paths
  if (lower.startsWith('drop')) return 'drop';
  if (lower.includes('surfaced') || lower.includes('surface to user')) {
    return 'surface';
  }

  // Path-based: find the EARLIEST occurrence of any artifact pattern.
  // Patterns include both path prefixes and explicit `<category>:` tags.
  const patterns = [
    { category: 'new-test', regex: /(tests\/|\.test\.|test:)/i },
    { category: 'new-tool', regex: /(scripts\/|tool:|\blib\/)/i },
    { category: 'new-skill', regex: /(\.claude\/skills\/|skill:)/i },
    { category: 'kb-archive', regex: /(docs\/kb\/|kb:)/i },
  ];

  let earliest = { category: 'unknown', index: Infinity };
  for (const { category, regex } of patterns) {
    const m = lower.match(regex);
    if (m && m.index !== undefined && m.index < earliest.index) {
      earliest = { category, index: m.index };
    }
  }

  return earliest.category;
}

function listInboxFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith('.md')).map((f) => join(dir, f));
}

function computeHealth(inboxDir) {
  const files = listInboxFiles(inboxDir);

  const byCategory = {
    'new-test': 0,
    'new-tool': 0,
    'new-skill': 0,
    'kb-archive': 0,
    drop: 0,
    surface: 0,
    unknown: 0,
  };

  let totalProcessed = 0;

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // skip unreadable file; don't break
    }
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    if (fm.status !== 'processed') continue; // only count processed entries

    const category = classify(fm.processed_into || '');
    byCategory[category]++;
    totalProcessed++;
  }

  const bindingNumerator = byCategory['new-test'] + byCategory['new-tool'];
  // Denominator excludes drop + surface (no artifact produced).
  const bindingDenominator = totalProcessed - byCategory['drop'] - byCategory['surface'];

  let bindingRatio = null;
  let healthy = null;
  if (bindingDenominator > 0) {
    bindingRatio = bindingNumerator / bindingDenominator;
    healthy = bindingRatio > 0.5;
  }

  return {
    inbox_dir: inboxDir,
    total_processed: totalProcessed,
    by_category: byCategory,
    binding_numerator: bindingNumerator,
    binding_denominator: bindingDenominator,
    binding_ratio: bindingRatio,
    healthy,
    threshold: 0.5,
  };
}

// Exported for tests; also runs when invoked as a script.
export { parseFrontmatter, classify, computeHealth };

// Detect direct invocation (vs import from test). Node ESM idiom.
const isMain =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/'));

if (isMain) {
  const result = computeHealth(inboxDir);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}
