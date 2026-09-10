import { HEALTH_SEVERITY, getHealthSeverity } from "../domain/monitor-health.js";

export function renderEventList(container, events) {
  container.replaceChildren();
  if (!events.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty-state";
    emptyItem.textContent = "暂无状态变化记录";
    container.append(emptyItem);
    return;
  }

  for (const event of events) {
    const item = document.createElement("li");
    item.className = `event-item event-item--${event.severity}`;
    const heading = document.createElement("strong");
    heading.textContent = `${event.sourceName}  ${event.severity === HEALTH_SEVERITY.NORMAL ? "恢复" : "异常"}`;
    const description = document.createElement("p");
    description.textContent = event.message;
    const timestamp = document.createElement("time");
    timestamp.dateTime = new Date(event.at).toISOString();
    timestamp.textContent = new Date(event.at).toLocaleString("zh-CN", { hour12: false });
    item.append(heading, description, timestamp);
    container.append(item);
  }
}

export function renderActiveEventSummary(elements, sources, sourceHealth) {
  const activeEvents = sources
    .map((source) => ({ source, health: sourceHealth.get(source.id) }))
    .filter(({ health }) => health && getHealthSeverity(health.state) !== HEALTH_SEVERITY.NORMAL);

  elements.eventCount.textContent = String(activeEvents.length);
  elements.eventCount.classList.toggle("has-events", activeEvents.length > 0);
  elements.eventMessage.textContent = activeEvents.length
    ? activeEvents.map(({ source, health }) => `${source.name} ${health.label}`).join("   ·   ")
    : "暂无信号异常";
}
