export const MONITOR_STATE = Object.freeze({
  UNCONFIGURED: "unconfigured",
  CONNECTING: "connecting",
  ONLINE: "online",
  WARNING: "warning",
  OFFLINE: "offline",
});

export const HEALTH_SEVERITY = Object.freeze({
  NORMAL: "normal",
  WARNING: "warning",
  CRITICAL: "critical",
});

export function getHealthSeverity(monitorState) {
  if (monitorState === MONITOR_STATE.OFFLINE) return HEALTH_SEVERITY.CRITICAL;
  if (monitorState === MONITOR_STATE.WARNING || monitorState === MONITOR_STATE.CONNECTING) {
    return HEALTH_SEVERITY.WARNING;
  }
  return HEALTH_SEVERITY.NORMAL;
}
