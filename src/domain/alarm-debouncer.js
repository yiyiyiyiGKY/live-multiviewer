import { HEALTH_SEVERITY } from "./monitor-health.js";

export class AlarmDebouncer {
  constructor(debounceMs) {
    this.debounceMs = debounceMs;
    this.states = new Map();
  }

  reset() {
    this.states.clear();
  }

  observe(sourceId, monitorState, severity, observedAt = Date.now()) {
    const state = this.states.get(sourceId) ?? {
      observedSeverity: HEALTH_SEVERITY.NORMAL,
      observedSince: observedAt,
      committedSeverity: HEALTH_SEVERITY.NORMAL,
    };

    if (monitorState === "connecting") {
      state.observedSeverity = severity;
      state.observedSince = observedAt;
      this.states.set(sourceId, state);
      return null;
    }
    if (state.observedSeverity !== severity) {
      state.observedSeverity = severity;
      state.observedSince = observedAt;
    }
    if (
      severity === state.committedSeverity ||
      observedAt - state.observedSince < this.debounceMs
    ) {
      this.states.set(sourceId, state);
      return null;
    }

    const transition = { from: state.committedSeverity, to: severity };
    state.committedSeverity = severity;
    this.states.set(sourceId, state);
    return transition;
  }
}
