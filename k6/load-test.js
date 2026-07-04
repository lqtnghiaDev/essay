// Load test: sustained normal-to-busy traffic (up to 30 VUs).
// Verifies the system meets its SLOs under expected load. VU peak is scaled to
// the dev environment's capacity, not production sizing.
import { iteration, report } from "./lib/common.js";

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 10 },
    { duration: "30s", target: 30 },
    { duration: "1m", target: 20 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.05"],
    checks: ["rate>0.95"],
  },
};

export default iteration;

export function handleSummary(data) {
  return report("load", data);
}
