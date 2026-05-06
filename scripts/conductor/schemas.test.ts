import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  StatusSchema,
  PlanSchema,
  ValidatorResultSchema,
  RoleSummarySchema,
} from "./schemas";

const fx = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf8"));

describe("StatusSchema", () => {
  it("parses a valid status", () => {
    expect(() => StatusSchema.parse(fx("status.valid.json"))).not.toThrow();
  });
  it("rejects status missing `phase`", () => {
    expect(() =>
      StatusSchema.parse(fx("status.invalid-missing-phase.json")),
    ).toThrow();
  });
});

describe("PlanSchema", () => {
  it("parses a valid plan", () => {
    expect(() => PlanSchema.parse(fx("plan.valid.json"))).not.toThrow();
  });
  it("rejects a plan whose blockedBy points at a non-existent task", () => {
    const bad = { ...fx("plan.valid.json") };
    bad.tasks = [
      { id: "t1", title: "x", blockedBy: ["does-not-exist"], risk: "low" },
    ];
    expect(() => PlanSchema.parse(bad)).toThrow();
  });
});

describe("ValidatorResultSchema", () => {
  it("parses a valid validator result", () => {
    expect(() =>
      ValidatorResultSchema.parse(fx("validator-result.valid.json")),
    ).not.toThrow();
  });
  it("requires failure fields when pass=false", () => {
    expect(() =>
      ValidatorResultSchema.parse({ pass: false }),
    ).toThrow();
  });
});

describe("RoleSummarySchema", () => {
  it("requires a summary_path", () => {
    expect(() =>
      RoleSummarySchema.parse({ status: "ok" }),
    ).toThrow();
  });
});
