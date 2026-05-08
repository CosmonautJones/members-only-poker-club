import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { SCHEMA_BY_ROLE, type RoleName } from './schemas';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SKILL_DIR = join(REPO_ROOT, '.claude', 'skills', 'conductor');
const TEMPLATES_DIR = join(SKILL_DIR, 'templates');
const COMMAND_FILE = join(REPO_ROOT, '.claude', 'commands', 'conductor.md');

// 12 roles after the v0.2 merges (planner+task-splitter, journalist+kb-curator).
const REQUIRED_TEMPLATES: RoleName[] = [
  'worker',
  'test-writer',
  'validator',
  'critic',
  'scope-judge',
  'premortem',
  'spec-writer',
  'planner',
  'ratifier',
  'shipper',
  'journalist',
  'retrospective',
];

// v0.1 roles that were removed in v0.2 — fail if their template files are
// still present, so a stale install can't quietly run with the old roster.
const REMOVED_TEMPLATES = ['task-splitter.md', 'knowledge-curator.md'];

const FRONTMATTER_NAME = /^name:\s*conductor\s*$/m;
const FRONTMATTER_DESC = /^description:\s*\S.*$/m;
const TEMPLATE_HEADING = /^#\s+Role:\s*(\S+)/m;
const TEMPLATE_VAR = /\{\{[^}]+\}\}/g;
const JSON_FENCE = /```json\s*\n([\s\S]*?)\n```/g;

// Extract all fenced ```json ... ``` blocks from a markdown body.
function extractJsonBlocks(body: string): string[] {
  return Array.from(body.matchAll(JSON_FENCE), (m) => m[1] ?? '');
}

// A template's example JSON typically uses {{template_var}} placeholders that
// aren't valid JSON. Substitute them with a sentinel string before parsing.
// Placeholders appear inside string positions (e.g. "summary_path": "{{...}}"),
// so the replacement is bare text that preserves the surrounding quotes.
function replacePlaceholders(json: string): string {
  return json.replace(TEMPLATE_VAR, '__placeholder__');
}

// Try to parse the example against the role's schema. Returns null on success,
// error message on failure. Templates may contain multiple JSON blocks (e.g.
// planner has both initial and split modes); pass if any block matches.
function checkRoleExampleJson(role: RoleName, body: string): string | null {
  const schema = SCHEMA_BY_ROLE[role];
  const blocks = extractJsonBlocks(body);
  if (blocks.length === 0) {
    return `template ${role}.md has no \`\`\`json example block`;
  }

  const errors: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const substituted = replacePlaceholders(block);
    let parsed: unknown;
    try {
      parsed = JSON.parse(substituted);
    } catch (e) {
      errors.push(
        `block ${i + 1}: not valid JSON after placeholder substitution (${(e as Error).message})`,
      );
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) {
      return null; // any one block matching is good enough
    }
    errors.push(`block ${i + 1}: ${result.error.issues.map((iss) => iss.message).join('; ')}`);
  }
  return `template ${role}.md example JSON does not match SCHEMA_BY_ROLE.${role}: ${errors.join(' | ')}`;
}

function checkTemplateNonEmpty(filePath: string, body: string): string | null {
  if (body.trim().length < 50) {
    return `template ${filePath} is empty or near-empty (< 50 non-whitespace chars)`;
  }
  return null;
}

function checkTemplateHeading(filePath: string, role: RoleName, body: string): string | null {
  const m = body.match(TEMPLATE_HEADING);
  if (!m) {
    return `template ${filePath} missing \`# Role: ${role}\` heading`;
  }
  if (m[1] !== role) {
    return `template ${filePath} role heading is "${m[1]}", expected "${role}"`;
  }
  return null;
}

export function validateConductorSkill(): { errors: string[] } {
  const errors: string[] = [];

  if (!existsSync(SKILL_DIR)) {
    errors.push(`missing dir: ${SKILL_DIR}`);
    return { errors };
  }

  // SKILL.md
  const skillMd = join(SKILL_DIR, 'SKILL.md');
  if (!existsSync(skillMd)) {
    errors.push(`missing file: ${skillMd}`);
  } else {
    const body = readFileSync(skillMd, 'utf8');
    if (!body.startsWith('---')) errors.push('SKILL.md missing frontmatter');
    if (!FRONTMATTER_NAME.test(body))
      errors.push('SKILL.md frontmatter missing or wrong `name: conductor`');
    if (!FRONTMATTER_DESC.test(body)) errors.push('SKILL.md frontmatter missing `description`');
    if (body.length < 1000) errors.push('SKILL.md suspiciously short (< 1000 chars)');
  }

  // Templates dir
  if (!existsSync(TEMPLATES_DIR)) {
    errors.push(`missing dir: ${TEMPLATES_DIR}`);
    return { errors };
  }

  const present = new Set(readdirSync(TEMPLATES_DIR));

  // Required present + structurally valid
  for (const role of REQUIRED_TEMPLATES) {
    const file = `${role}.md`;
    if (!present.has(file)) {
      errors.push(`missing template: ${file}`);
      continue;
    }
    const filePath = join(TEMPLATES_DIR, file);
    const body = readFileSync(filePath, 'utf8');

    const emptyErr = checkTemplateNonEmpty(file, body);
    if (emptyErr) errors.push(emptyErr);

    const headingErr = checkTemplateHeading(file, role, body);
    if (headingErr) errors.push(headingErr);

    // Skip schema check for templates with empty/heading errors.
    if (!emptyErr && !headingErr) {
      const schemaErr = checkRoleExampleJson(role, body);
      if (schemaErr) errors.push(schemaErr);
    }
  }

  // Removed templates must NOT be present (catches stale v0.1 installs).
  for (const removed of REMOVED_TEMPLATES) {
    if (present.has(removed)) {
      errors.push(
        `stale v0.1 template still present: ${removed} (merged into another role in v0.2)`,
      );
    }
  }

  // Slash command
  if (!existsSync(COMMAND_FILE)) {
    errors.push(`missing slash command: ${COMMAND_FILE}`);
  }

  return { errors };
}

// Suppress unused-import noise — z is the type system root for SCHEMA_BY_ROLE.
void z;
