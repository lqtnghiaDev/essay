import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

// Target URL is injected by the CI perf-test action via --env TARGET_URL=...
const TARGET_URL = __ENV.TARGET_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '30s', target: 10 }, // ramp up to 10 virtual users
    { duration: '1m', target: 10 }, // hold
    { duration: '30s', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'], // 95% of requests under 800ms
    http_req_failed: ['rate<0.05'], // error rate under 5%
  },
};

export default function () {
  const res = http.get(TARGET_URL);
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}

// Emit a browser-viewable HTML report and an Excel-friendly CSV alongside
// the machine-readable JSON the CI step parses.
export function handleSummary(data) {
  const d = data.metrics.http_req_duration.values;
  const failRate = data.metrics.http_req_failed.values.rate;
  const totalReqs = data.metrics.http_reqs.values.count;
  const reqRate = data.metrics.http_reqs.values.rate;
  const pass = d['p(95)'] < 800 && failRate < 0.05;

  const rows = [
    ['Metric', 'Value'],
    ['Total requests', totalReqs],
    ['Requests / sec', reqRate.toFixed(2)],
    ['Avg latency (ms)', Math.round(d.avg)],
    ['p90 latency (ms)', Math.round(d['p(90)'])],
    ['p95 latency (ms)', Math.round(d['p(95)'])],
    ['Max latency (ms)', Math.round(d.max)],
    ['Error rate (%)', (failRate * 100).toFixed(2)],
    ['Result', pass ? 'PASS' : 'FAIL'],
  ];
  const csv = rows.map((r) => r.join(',')).join('\n');

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'k6-report.html': htmlReport(data),
    'k6-summary.csv': csv,
  };
}
