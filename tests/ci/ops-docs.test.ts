import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

const repoRoot = resolve(__dirname, "..", "..");
const workflowPath = resolve(repoRoot, ".github", "workflows", "ci.yml");

describe("CI ops documentation", () => {
  it("docs/ops/ci-secrets.md exists and references production-secret carve-out", () => {
    const path = resolve(repoRoot, "docs", "ops", "ci-secrets.md");
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, "utf8");
    expect(body).toMatch(/Production secrets/i);
    expect(body).toContain("ADR-0007");
  });

  it("AC9: every secrets.NAME ref in ci.yml is documented in docs/ops/ci-secrets.md", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const docPath = resolve(repoRoot, "docs", "ops", "ci-secrets.md");
    const docBody = readFileSync(docPath, "utf8");
    const matches = [...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)/g)];
    const referencedNames = new Set(matches.map((m) => m[1]));
    expect(referencedNames.size).toBeGreaterThan(0);
    for (const name of referencedNames) {
      expect(docBody, `secret ${name} referenced in ci.yml but not in docs/ops/ci-secrets.md`).toContain(name);
    }
  });

  it("AC7: docs/ops/branch-protection.md required-checks list matches ci.yml job names exactly", () => {
    const docPath = resolve(repoRoot, "docs", "ops", "branch-protection.md");
    const docBody = readFileSync(docPath, "utf8");
    const wf = yaml.load(readFileSync(workflowPath, "utf8")) as { jobs: Record<string, { name?: string }> };
    for (const [jobId, job] of Object.entries(wf.jobs)) {
      const displayName = job.name ?? jobId;
      expect(docBody, `branch-protection.md must reference ci.yml job "${displayName}"`).toContain(displayName);
    }
  });

  it("AC10: CONTRIBUTING.md has all required onboarding sections", () => {
    const path = resolve(repoRoot, "CONTRIBUTING.md");
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, "utf8");
    expect(body).toMatch(/^##\s+Signed commits\b/m);
    expect(body).toContain("git config --global commit.gpgsign true");
    expect(body).toMatch(/^##\s+(Pre-commit hooks|Husky)/m);
    expect(body.toLowerCase()).toContain("gpg");
    expect(body.toLowerCase()).toContain("ssh");
  });
});
