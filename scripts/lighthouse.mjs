#!/usr/bin/env node
/**
 * Lighthouse perf-budget driver for ADR-0030.
 *
 * Runs Lighthouse against the four Slice-1 marketing routes that AC10 of
 * `docs/specs/0030-seo-and-content-strategy-implementation.md` enumerates
 * (`/`, `/games`, `/contact`, `/faq`). Fails (`exit 1`) if any page scores
 * below 90 on `categories.performance`. Writes a consolidated JSON report
 * to `lighthouse-report.json` at the repo root and prints a per-page score
 * table to stdout.
 *
 * Configuration (env):
 *   - LIGHTHOUSE_BASE_URL: defaults to `http://localhost:3000`. If set, the
 *     driver assumes a server is already running at that URL and audits
 *     against it. Use this in CI where the build + start step is a separate
 *     pipeline stage.
 *   - LIGHTHOUSE_SPAWN_SERVER: when truthy ("1" / "true") AND
 *     `LIGHTHOUSE_BASE_URL` is unset, the driver spawns
 *     `corepack pnpm start` itself, waits for the port to be reachable,
 *     and tears it down on exit. Useful for `pnpm lighthouse` locally
 *     against a freshly-built bundle.
 *
 * CI wiring follow-up: ADR-0017 (CI/CD) is currently Stub. Per ADR-0030
 * Open Question 2, the CI gate stays a manual `pnpm lighthouse`
 * invocation until ADR-0017 ratifies and a workflow is wired in.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'http://localhost:3000';
const PATHS = ['/', '/games', '/contact', '/faq'];
const PERF_THRESHOLD = 90;
const REPORT_PATH = path.join(REPO_ROOT, 'lighthouse-report.json');
const SERVER_READY_TIMEOUT_MS = 60_000;
const SERVER_READY_POLL_MS = 500;

/** @typedef {{ url: string; path: string; performance: number | null }} PageResult */

function isTruthyEnv(v) {
  if (!v) return false;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.createConnection({ host, port });
      let settled = false;
      socket.once('connect', () => {
        settled = true;
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        if (settled) return;
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port} after ${timeoutMs}ms`));
        } else {
          setTimeout(tryOnce, SERVER_READY_POLL_MS);
        }
      });
    };
    tryOnce();
  });
}

async function maybeSpawnServer() {
  const baseUrlEnv = process.env.LIGHTHOUSE_BASE_URL;
  const shouldSpawn = !baseUrlEnv && isTruthyEnv(process.env.LIGHTHOUSE_SPAWN_SERVER);
  if (!shouldSpawn) {
    return { baseUrl: baseUrlEnv ?? DEFAULT_BASE_URL, child: null };
  }
  // Start `corepack pnpm start` and wait for :3000 to accept connections.
  // eslint-disable-next-line no-console
  console.log('[lighthouse] spawning `corepack pnpm start` ...');
  const isWindows = process.platform === 'win32';
  const child = spawn('corepack', ['pnpm', 'start'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: isWindows,
    env: { ...process.env, PORT: '3000' },
  });
  child.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[lighthouse] failed to spawn next start:', err);
  });
  await waitForPort('127.0.0.1', 3000, SERVER_READY_TIMEOUT_MS);
  // eslint-disable-next-line no-console
  console.log('[lighthouse] server ready on http://localhost:3000');
  return { baseUrl: DEFAULT_BASE_URL, child };
}

async function runLighthouseFor(url, port) {
  const result = await lighthouse(
    url,
    {
      port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
    },
    undefined,
  );
  if (!result) {
    throw new Error(`Lighthouse returned no result for ${url}`);
  }
  return result;
}

async function main() {
  const { baseUrl, child: serverChild } = await maybeSpawnServer();

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });
  /** @type {PageResult[]} */
  const results = [];
  /** @type {Record<string, unknown>} */
  const fullReports = {};
  let exitCode = 0;

  try {
    for (const p of PATHS) {
      const url = new URL(p, baseUrl).toString();
      // eslint-disable-next-line no-console
      console.log(`[lighthouse] auditing ${url} ...`);
      const result = await runLighthouseFor(url, chrome.port);
      const lhr = result.lhr;
      const perfCategory = lhr.categories?.performance;
      const score =
        perfCategory && typeof perfCategory.score === 'number' ? perfCategory.score * 100 : null;
      results.push({ url, path: p, performance: score });
      fullReports[p] = lhr;
      if (score === null || score < PERF_THRESHOLD) {
        exitCode = 1;
      }
    }
  } finally {
    await chrome.kill();
    if (serverChild && !serverChild.killed) {
      serverChild.kill('SIGTERM');
    }
  }

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      { baseUrl, threshold: PERF_THRESHOLD, results, lhr: fullReports },
      null,
      2,
    ),
  );

  // eslint-disable-next-line no-console
  console.log('\nLighthouse perf scores:');
  // eslint-disable-next-line no-console
  console.log('  Path                       Performance   Status');
  // eslint-disable-next-line no-console
  console.log('  ' + '-'.repeat(54));
  for (const r of results) {
    const scoreText = r.performance === null ? '   --' : r.performance.toFixed(1).padStart(5, ' ');
    const status =
      r.performance !== null && r.performance >= PERF_THRESHOLD ? 'PASS' : 'FAIL (<90)';
    // eslint-disable-next-line no-console
    console.log(`  ${r.path.padEnd(26, ' ')} ${scoreText.padStart(11, ' ')}   ${status}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\nReport written to ${path.relative(REPO_ROOT, REPORT_PATH)}`);

  if (exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.error(`\nOne or more pages scored below the ${PERF_THRESHOLD} performance threshold.`);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[lighthouse] driver crashed:', err);
  process.exit(1);
});
