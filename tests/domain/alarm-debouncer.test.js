import test from "node:test";
import assert from "node:assert/strict";

import { AlarmDebouncer } from "../../src/domain/alarm-debouncer.js";
import { HEALTH_SEVERITY } from "../../src/domain/monitor-health.js";

test("连接过程和短暂抖动不会写入值守事件", () => {
  const alarms = new AlarmDebouncer(3_000);
  assert.equal(alarms.observe("source-1", "connecting", HEALTH_SEVERITY.WARNING, 0), null);
  assert.equal(alarms.observe("source-1", "warning", HEALTH_SEVERITY.WARNING, 1_000), null);
  assert.equal(alarms.observe("source-1", "online", HEALTH_SEVERITY.NORMAL, 2_000), null);
});

test("持续异常和持续恢复各只提交一次", () => {
  const alarms = new AlarmDebouncer(3_000);
  assert.equal(alarms.observe("source-1", "offline", HEALTH_SEVERITY.CRITICAL, 0), null);
  assert.deepEqual(alarms.observe("source-1", "offline", HEALTH_SEVERITY.CRITICAL, 3_000), {
    from: HEALTH_SEVERITY.NORMAL,
    to: HEALTH_SEVERITY.CRITICAL,
  });
  assert.equal(alarms.observe("source-1", "offline", HEALTH_SEVERITY.CRITICAL, 6_000), null);
  assert.equal(alarms.observe("source-1", "online", HEALTH_SEVERITY.NORMAL, 7_000), null);
  assert.deepEqual(alarms.observe("source-1", "online", HEALTH_SEVERITY.NORMAL, 10_000), {
    from: HEALTH_SEVERITY.CRITICAL,
    to: HEALTH_SEVERITY.NORMAL,
  });
});

test("更换一路来源只清除该路告警状态", () => {
  const alarms = new AlarmDebouncer(3_000);
  alarms.observe("source-1", "offline", HEALTH_SEVERITY.CRITICAL, 0);
  alarms.observe("source-2", "offline", HEALTH_SEVERITY.CRITICAL, 0);
  alarms.forget("source-1");
  assert.equal(alarms.states.has("source-1"), false);
  assert.equal(alarms.states.has("source-2"), true);
});
