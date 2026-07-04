// Shared request logic and reporting for all k6 test profiles.
// Each test file (smoke / load / stress / spike / soak) imports from here and
// only defines its own `options` (stages, VUs, thresholds).
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

export const pageLoadTrend = new Trend("page_load_time", true);

const BASE_URL = __ENV.TARGET_URL || "http://localhost:80";

// One iteration: hit the index, a JS bundle if present, and an SPA route.
export function iteration() {
  const indexRes = http.get(`${BASE_URL}/`);
  check(indexRes, {
    "index status is 200": (r) => r.status === 200,
    "index has content": (r) => r.body && r.body.length > 0,
  });
  pageLoadTrend.add(indexRes.timings.duration);

  // Next.js serves hashed JS chunks under /_next/static; fetch one if the
  // index references it, to exercise static-asset delivery. Skipped when the
  // index has none (e.g. the backend root returns a plain string), so the same
  // script fits both the frontend and backend targets.
  const assetMatch =
    indexRes.body && indexRes.body.match(/(\/_next\/static\/[^"'?]+\.js)/);
  if (assetMatch) {
    const assetRes = http.get(`${BASE_URL}${assetMatch[1]}`, {
      tags: { name: "static_chunk" },
    });
    check(assetRes, {
      "static chunk is 200": (r) => r.status === 200,
    });
  }

  sleep(1);
}

// Build the stdout text summary, a browser-viewable HTML report and an
// Excel-friendly CSV. `prefix` keeps report files from different test types
// from overwriting each other when several run in the same job.
export function report(prefix, data) {
  const d = data.metrics.http_req_duration.values;
  const failRate = data.metrics.http_req_failed.values.rate;
  const totalReqs = data.metrics.http_reqs.values.count;
  const reqRate = data.metrics.http_reqs.values.rate;

  const rows = [
    ["Metric", "Value"],
    ["Test type", prefix],
    ["Total requests", totalReqs],
    ["Requests / sec", reqRate.toFixed(2)],
    ["Avg latency (ms)", Math.round(d.avg)],
    ["p90 latency (ms)", Math.round(d["p(90)"])],
    ["p95 latency (ms)", Math.round(d["p(95)"])],
    ["Max latency (ms)", Math.round(d.max)],
    ["Error rate (%)", (failRate * 100).toFixed(2)],
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
    [`k6-${prefix}-report.html`]: htmlReport(data),
    [`k6-${prefix}-summary.csv`]: csv,
  };
}
