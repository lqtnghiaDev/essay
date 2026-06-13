// Shared request logic and reporting for all k6 test profiles.
// Each test file (smoke / load / stress / spike / soak) imports from here and
// only defines its own `options` (stages, VUs, thresholds).
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

export const errorRate = new Rate("errors");
export const pageLoadTrend = new Trend("page_load_time", true);

const BASE_URL = __ENV.TARGET_URL || "http://localhost:80";

// One iteration: hit the index, a JS bundle if present, and an SPA route.
export function iteration() {
  const indexRes = http.get(`${BASE_URL}/`);
  check(indexRes, {
    "index status is 200": (r) => r.status === 200,
    "index has content": (r) => r.body && r.body.length > 0,
  }) || errorRate.add(1);
  pageLoadTrend.add(indexRes.timings.duration);

  const assetMatch =
    indexRes.body && indexRes.body.match(/src="(\/assets\/[^"]+\.js)"/);
  if (assetMatch) {
    const assetUrl = `${BASE_URL}${assetMatch[1]}`;
    const assetRes = http.get(assetUrl, { tags: { name: "main_bundle" } });
    check(assetRes, {
      "bundle status is 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  }

  const spaRes = http.get(`${BASE_URL}/campaign/1`);
  check(spaRes, {
    "SPA route returns 200": (r) => r.status === 200,
    "SPA route has HTML": (r) => r.body && r.body.includes("<!DOCTYPE"),
  }) || errorRate.add(1);

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
