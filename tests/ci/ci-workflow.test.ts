import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

const workflowPath = resolve(__dirname, "..", "..", ".github", "workflows", "ci.yml");
const workflow = yaml.load(readFileSync(workflowPath, "utf8")) as Record<string, unknown>;

describe(".github/workflows/ci.yml structure", () => {
  it("has on: pull_request and on: push to main", () => {
    const on = workflow.on as Record<string, unknown>;
    expect(on).toBeDefined();
    expect(on).toHaveProperty("pull_request");
    expect(on).toHaveProperty("push");
    const push = on.push as { branches?: string[] };
    expect(push.branches).toEqual(["main"]);
  });

  it("has a concurrency block that cancels in-progress runs", () => {
    expect(workflow.concurrency).toBeDefined();
    const concurrency = workflow.concurrency as { group: string; "cancel-in-progress": boolean };
    expect(concurrency["cancel-in-progress"]).toBe(true);
  });

  it("contains the required jobs in YAML document order", () => {
    const jobs = workflow.jobs as Record<string, unknown>;
    expect(jobs).toBeDefined();
    const jobIds = Object.keys(jobs); // js-yaml preserves YAML document order
    const required = ["install", "typecheck", "lint", "test", "e2e", "lighthouse", "backstop-greps", "migrate-staging"];
    for (const r of required) {
      expect(jobIds).toContain(r);
    }
  });

  it("flattened step list contains required pipeline substrings in order", () => {
    const jobs = workflow.jobs as Record<string, { steps?: Array<{ name?: string; run?: string; uses?: string }> }>;
    const flatNames: string[] = [];
    for (const [jobId, job] of Object.entries(jobs)) {
      flatNames.push(`__JOB:${jobId}`);
      for (const step of job.steps ?? []) {
        flatNames.push((step.name ?? step.run ?? step.uses ?? "").toLowerCase());
      }
    }
    const flat = flatNames.join("\n");
    // Pointer scan: each substring must appear AFTER the previous one's match position.
    const ordered = ["install", "typecheck", "lint", "test", "playwright", "lighthouse"];
    let lastIdx = -1;
    for (const sub of ordered) {
      const idx = flat.indexOf(sub, lastIdx + 1);
      expect(idx, `expected ${sub} after position ${lastIdx}`).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("each job has a timeout-minutes set", () => {
    const jobs = workflow.jobs as Record<string, { "timeout-minutes"?: number }>;
    for (const [jobId, job] of Object.entries(jobs)) {
      expect(job["timeout-minutes"], `${jobId} missing timeout-minutes`).toBeGreaterThan(0);
    }
  });
});

describe("workflow env wiring", () => {
  it("AC4: lighthouse job sets LIGHTHOUSE_BASE_URL from a Vercel-related secret", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("LIGHTHOUSE_BASE_URL");
    expect(workflow).toMatch(/secrets\.VERCEL_PREVIEW_URL/);
  });
});
