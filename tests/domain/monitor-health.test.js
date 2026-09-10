import test from "node:test";
import assert from "node:assert/strict";

import {
  HEALTH_SEVERITY,
  MONITOR_STATE,
  getHealthSeverity,
} from "../../src/domain/monitor-health.js";

test("状态分级保持断流高于等待", () => {
  assert.equal(getHealthSeverity(MONITOR_STATE.ONLINE), HEALTH_SEVERITY.NORMAL);
  assert.equal(getHealthSeverity(MONITOR_STATE.UNCONFIGURED), HEALTH_SEVERITY.NORMAL);
  assert.equal(getHealthSeverity(MONITOR_STATE.WARNING), HEALTH_SEVERITY.WARNING);
  assert.equal(getHealthSeverity(MONITOR_STATE.CONNECTING), HEALTH_SEVERITY.WARNING);
  assert.equal(getHealthSeverity(MONITOR_STATE.OFFLINE), HEALTH_SEVERITY.CRITICAL);
});
