// Spike test: sudden jump to very high load, then back down.
// Checks how the system absorbs a burst and whether it recovers afterwards.
import { iteration, report } from "./lib/common.js";

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "20s", target: 300 },
    { duration: "1m", target: 300 },
    { duration: "20s", target: 10 },
    { duration: "1m", target: 10 },
    { duration: "20s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<10000"],
    http_req_failed: ["rate<0.15"],
  },
};

export default iteration;

export function handleSummary(data) {
  return report("spike", data);
}
