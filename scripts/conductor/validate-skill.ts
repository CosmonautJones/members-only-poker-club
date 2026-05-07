import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SKILL_DIR = join(REPO_ROOT, '.claude', 'skills', 'conductor');
const TEMPLATES_DIR = join(SKILL_DIR, 'templates');
const COMMAND_FILE = join(REPO_ROOT, '.claude', 'commands', 'conductor.md');

const REQUIRED_TEMPLATES = [
  'worker.md',
  'test-writer.md',
  'validator.md',
  'critic.md',
  'scope-judge.md',
  'premortem.md',
  'spec-writer.md',
  'planner.md',
  'task-splitter.md',
  'ratifier.md',
  'shipper.md',
  'journalist.md',
  'knowledge-curator.md',
  'retrospective.md',
];

const FRONTMATTER_NAME = /^name:\s*conductor\s*$/m;
const FRONTMATTER_DESC = /^description:\s*.+\S.*$/m;

export function validateConductorSkill(): { errors: string[] } {
  const errors: string[] = [];

  if (!existsSync(SKILL_DIR)) {
    errors.push(`missing dir: ${SKILL_DIR}`);
    return { errors };
  }

  const skillMd = join(SKILL_DIR, 'SKILL.md');
  if (!existsSync(skillMd)) {
    errors.push(`missing file: ${skillMd}`);
  } else {
    const body = readFileSync(skillMd, 'utf8');
    if (!body.startsWith('---')) errors.push('SKILL.md missing frontmatter');
    if (!FRONTMATTER_NAME.test(body))
      errors.push('SKILL.md frontmatter missing or wrong `name: conductor`');
    if (!FRONTMATTER_DESC.test(body)) errors.push('SKILL.md frontmatter missing `description`');
  }

  if (!existsSync(TEMPLATES_DIR)) {
    errors.push(`missing dir: ${TEMPLATES_DIR}`);
  } else {
    const present = new Set(readdirSync(TEMPLATES_DIR));
    for (const t of REQUIRED_TEMPLATES) {
      if (!present.has(t)) errors.push(`missing template: ${t}`);
    }
  }

  if (!existsSync(COMMAND_FILE)) {
    errors.push(`missing slash command: ${COMMAND_FILE}`);
  }

  return { errors };
}
