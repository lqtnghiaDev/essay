// Smoke test: minimal load to confirm the system works at all.
// Fast — run it as a gate before the heavier profiles.
import { iteration, report } from "./lib/common.js";

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

export default iteration;

export function handleSummary(data) {
  return report("smoke", data);
}
