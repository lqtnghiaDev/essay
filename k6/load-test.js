// Load test: sustained normal-to-busy traffic (up to 50 VUs).
// Verifies the system meets its SLOs under expected production load.
import { iteration, report } from "./lib/common.js";

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 10 },
    { duration: "30s", target: 50 },
    { duration: "1m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.05"],
    errors: ["rate<0.05"],
  },
};

export default iteration;

export function handleSummary(data) {
  return report("load", data);
}
