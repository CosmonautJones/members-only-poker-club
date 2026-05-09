import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Canonicalization rules for ADR/spec content signatures (v0.3).
//
// Goal: hash the *substantive* prose so that frontmatter timestamp churn
// (Ratified: <date> set after the fact, content_signature itself, future
// amendments to non-decision metadata) does not trigger spurious staleness
// on /conductor resume. Substantive text changes (Context, Decision,
// Consequences, Alternatives) DO trigger.
//
// Steps:
//   1. Strip the YAML frontmatter except for `Status` and `Slice` (these are
//      treated as substantive — flipping Status from Stub to Accepted, or
//      changing the Slice an ADR ships in, is a real semantic change worth
//      detecting).
//   2. Drop trailing whitespace on each line and collapse runs of blank
//      lines so that whitespace edits don't trigger.
//   3. SHA-256 the result. Return the hex digest.

// Keys whose values are substantive: changing them means a different decision.
// Everything else in frontmatter (Date, Ratified, content_signature, etc.) is
// transparent — its churn is metadata, not semantics.
const KEPT_FRONTMATTER_KEYS = new Set(['Status', 'Slice', 'Supersedes', 'Superseded by']);

// This repo (and many ADR conventions) uses *bullet-style* frontmatter rather
// than a YAML `---` block: between the H1 and the first H2, lines like
// `- **Status:** Accepted` carry the same metadata. Without this stripping,
// a `content_signature: <hash>` bullet leaks into the hashed body and the
// hash becomes a function of itself — recursive, useless. We strip the
// bullet-frontmatter region (H1 → first H2) of any `- **<key>:** <value>`
// line whose key is not in KEPT_FRONTMATTER_KEYS.
const BULLET_FRONTMATTER_RE = /^-\s+\*\*([A-Za-z][A-Za-z0-9_ -]*?):\*\*\s*(.*)$/;

function stripBulletFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  // Find the first H2 (`## ...`). Bullet frontmatter only lives before it.
  let firstH2 = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i] ?? '')) {
      firstH2 = i;
      break;
    }
  }
  if (firstH2 === -1) return text;

  const head = lines.slice(0, firstH2);
  const tail = lines.slice(firstH2);
  const filtered: string[] = [];
  for (const line of head) {
    const m = BULLET_FRONTMATTER_RE.exec(line);
    if (m) {
      const key = m[1]!.trim();
      if (KEPT_FRONTMATTER_KEYS.has(key)) {
        filtered.push(`- **${key}:** ${(m[2] ?? '').trim()}`);
      }
      // else: drop the bullet entirely
      continue;
    }
    filtered.push(line);
  }
  return [...filtered, ...tail].join('\n');
}

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return text;
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return text;

  const fm = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join('\n');

  const kept: string[] = [];
  for (const raw of fm) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1]!;
    if (KEPT_FRONTMATTER_KEYS.has(key)) {
      kept.push(`${key}: ${(m[2] ?? '').trim()}`);
    }
  }
  if (kept.length === 0) return body;
  return `---\n${kept.join('\n')}\n---\n${body}`;
}

function normalizeWhitespace(text: string): string {
  // Strip trailing whitespace per line; collapse all runs of blank lines to a
  // single blank line. ADRs don't have semantically meaningful multi-blank
  // spans (no large fenced blocks with intentional empty lines), so this is
  // safe and matches markdown rendering equivalence.
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''));
  const collapsed: string[] = [];
  let inBlankRun = false;
  for (const line of lines) {
    if (line === '') {
      if (!inBlankRun) collapsed.push('');
      inBlankRun = true;
    } else {
      inBlankRun = false;
      collapsed.push(line);
    }
  }
  while (collapsed.length && collapsed[0] === '') collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1] === '') collapsed.pop();
  return collapsed.join('\n') + '\n';
}

export function canonicalText(text: string): string {
  // Order matters: YAML strip first (handles foreign-style frontmatter), then
  // bullet strip (handles ADR convention in this repo and similar), then
  // whitespace normalization.
  return normalizeWhitespace(stripBulletFrontmatter(stripFrontmatter(text)));
}

export function canonicalHash(text: string): string {
  return createHash('sha256').update(canonicalText(text)).digest('hex');
}

export function canonicalSignature(filePath: string): string {
  return canonicalHash(readFileSync(filePath, 'utf8'));
}

export function shortSignature(hash: string): string {
  return hash.slice(0, 12);
}
