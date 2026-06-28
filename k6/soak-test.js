// Soak test: moderate load held for a long time to surface memory leaks,
// connection-pool exhaustion and slow degradation. Long-running (~40m).
import { iteration, report } from "./lib/common.js";

export const options = {
  stages: [
    { duration: "5m", target: 30 },
    { duration: "30m", target: 30 },
    { duration: "5m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.05"],
    checks: ["rate>0.95"],
  },
};

export default iteration;

export function handleSummary(data) {
  return report("soak", data);
}
