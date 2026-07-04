// Stress test: ramp well beyond normal load to find the breaking point.
// Thresholds are looser — degradation is expected at the top of the ramp.
import { iteration, report } from "./lib/common.js";

export const options = {
  stages: [
    { duration: "1m", target: 50 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 200 },
    { duration: "2m", target: 300 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<8000"],
    http_req_failed: ["rate<0.10"],
  },
};

export default iteration;

export function handleSummary(data) {
  return report("stress", data);
}
