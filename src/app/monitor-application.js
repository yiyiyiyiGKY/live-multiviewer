import { getHealthSeverity } from "../domain/monitor-health.js";
import { AlarmDebouncer } from "../domain/alarm-debouncer.js";
import { isSupportedMediaUrl, moveSource, validateSources } from "../domain/source.js";
import { SourceMediaSession } from "../media/source-media-session.js";
import { formatDuration } from "../shared/format-duration.js";
import { renderActiveEventSummary, renderEventList } from "../ui/event-list.js";
import { readSourceConfigForm, renderSourceConfigForm } from "../ui/source-config-form.js";
import { createSourceTile, updateSourceTileHealth } from "../ui/source-tile.js";

const RUNTIME_UPDATE_INTERVAL_MS = 1_000;
const GATEWAY_UPDATE_INTERVAL_MS = 5_000;
const MAX_RETAINED_EVENTS = 100;
const ALARM_DEBOUNCE_MS = 3_000;

export class MonitorApplication {
  constructor({ elements, stateRepository, gatewayClient }) {
    this.elements = elements;
    this.stateRepository = stateRepository;
    this.gatewayClient = gatewayClient;
    this.state = {
      sources: [],
      layoutLocked: true,
      selectedSourceId: null,
      focusedSourceId: null,
      listenedSourceId: null,
      events: [],
      sourceHealth: new Map(),
      mediaSessions: new Map(),
      sourceTiles: new Map(),
      startedAt: Date.now(),
    };
    this.eventController = new AbortController();
    this.alarmDebouncer = new AlarmDebouncer(ALARM_DEBOUNCE_MS);
    this.runtimeTimer = null;
    this.gatewayTimer = null;
    this.toastTimer = null;
    this.savingConfiguration = false;
  }

  async start() {
    const settings = await this.stateRepository.loadSettings();
    this.state.sources = settings.sources;
    this.state.layoutLocked = settings.layoutLocked;
    this.state.events = this.stateRepository.loadEvents();
    this.bindStaticEvents();
    renderEventList(this.elements.eventList, this.state.events);
    this.mountSourceGrid();
    this.updateRuntimeClock();
    this.updateGatewayStatus();
    this.runtimeTimer = window.setInterval(
      () => this.updateRuntimeClock(),
      RUNTIME_UPDATE_INTERVAL_MS,
    );
    this.gatewayTimer = window.setInterval(
      () => this.updateGatewayStatus(),
      GATEWAY_UPDATE_INTERVAL_MS,
    );
  }

  stop() {
    this.eventController.abort();
    window.clearInterval(this.runtimeTimer);
    window.clearInterval(this.gatewayTimer);
    window.clearTimeout(this.toastTimer);
    for (const mediaSession of this.state.mediaSessions.values()) mediaSession.dispose();
    this.state.mediaSessions.clear();
  }

  bindStaticEvents() {
    const listenerOptions = { signal: this.eventController.signal };
    this.elements.lockButton.addEventListener(
      "click",
      () => this.toggleLayoutLock(),
      listenerOptions,
    );
    this.elements.configButton.addEventListener(
      "click",
      () => this.openSourceConfiguration(),
      listenerOptions,
    );
    this.elements.configForm.addEventListener(
      "submit",
      (event) => this.handleConfigurationSubmit(event),
      listenerOptions,
    );
    this.elements.reconnectButton.addEventListener(
      "click",
      () => this.reconnectSources(),
      listenerOptions,
    );
    this.elements.fullscreenButton.addEventListener(
      "click",
      () => this.toggleFullscreen(),
      listenerOptions,
    );
    this.elements.eventsButton.addEventListener(
      "click",
      () => this.openEventDrawer(),
      listenerOptions,
    );
    this.elements.closeEventsButton.addEventListener(
      "click",
      () => this.closeEventDrawer(),
      listenerOptions,
    );
    this.elements.clearEventsButton.addEventListener(
      "click",
      () => this.clearEvents(),
      listenerOptions,
    );
    document.addEventListener(
      "fullscreenchange",
      () => this.updateFullscreenButton(),
      listenerOptions,
    );
    document.addEventListener(
      "keydown",
      (event) => this.handleGlobalKeydown(event),
      listenerOptions,
    );
  }

  mountSourceGrid() {
    for (const mediaSession of this.state.mediaSessions.values()) mediaSession.dispose();
    this.state.mediaSessions.clear();
    this.state.sourceTiles.clear();
    this.state.sourceHealth.clear();
    this.alarmDebouncer.reset();
    this.elements.sourceGrid.replaceChildren();

    for (const source of this.state.sources) this.mountSource(source);

    this.updateSourceOrder();
    this.updateSourcePresentation();
    this.updateToolbar();
  }

  mountSource(source) {
    const sourceTile = createSourceTile(source, {
      isLayoutLocked: () => this.state.layoutLocked,
      onSelect: (sourceId) => this.toggleSourceListening(sourceId),
      onFocus: (sourceId) => this.toggleSourceFocus(sourceId),
      onMove: (sourceId, targetId) => this.reorderSource(sourceId, targetId),
      onConfigure: (sourceId) => this.openSourceConfiguration(sourceId),
    });
    this.elements.sourceGrid.append(sourceTile.root);
    this.state.sourceTiles.set(source.id, sourceTile);

    const mediaSession = new SourceMediaSession(
      source,
      (health) => this.handleSourceHealth(source, health),
      this.gatewayClient,
    );
    this.state.mediaSessions.set(source.id, mediaSession);
    mediaSession.mount(sourceTile.mediaHost);
  }

  updateSourceOrder() {
    for (const [index, source] of this.state.sources.entries()) {
      this.state.sourceTiles.get(source.id).root.style.order = index;
    }
  }

  toggleSourceListening(sourceId) {
    this.state.selectedSourceId = sourceId;
    this.state.listenedSourceId = this.state.listenedSourceId === sourceId ? null : sourceId;
    for (const [id, mediaSession] of this.state.mediaSessions) {
      mediaSession.setMuted(id !== this.state.listenedSourceId);
    }
    this.updateSourcePresentation();

    const source = this.findSource(sourceId);
    this.showToast(this.state.listenedSourceId ? `正在监听 ${source.name}` : "已关闭单路监听");
  }

  toggleSourceFocus(sourceId) {
    this.state.focusedSourceId = this.state.focusedSourceId === sourceId ? null : sourceId;
    document.body.classList.toggle("focus-mode", Boolean(this.state.focusedSourceId));
    this.updateSourcePresentation();
  }

  reorderSource(sourceId, targetId) {
    if (!sourceId || sourceId === targetId) return;
    const reorderedSources = moveSource(this.state.sources, sourceId, targetId);
    if (reorderedSources.every((source, index) => source.id === this.state.sources[index].id))
      return;
    this.state.sources = reorderedSources;
    this.saveSettings();
    this.updateSourceOrder();
    this.showToast("视频源位置已更新");
  }

  updateSourcePresentation() {
    for (const [sourceId, sourceTile] of this.state.sourceTiles) {
      sourceTile.root.classList.toggle("is-selected", this.state.selectedSourceId === sourceId);
      sourceTile.root.classList.toggle("is-focused", this.state.focusedSourceId === sourceId);
      sourceTile.root.classList.toggle(
        "is-hidden-by-focus",
        Boolean(this.state.focusedSourceId) && this.state.focusedSourceId !== sourceId,
      );
      sourceTile.root.draggable = !this.state.layoutLocked;
      sourceTile.listeningBadge.classList.toggle(
        "is-visible",
        this.state.listenedSourceId === sourceId,
      );
    }
  }

  handleSourceHealth(source, health) {
    if (this.findSource(source.id) !== source) return;
    this.state.sourceHealth.set(source.id, health);
    const currentSeverity = getHealthSeverity(health.state);
    this.updateDebouncedAlarm(source, health, currentSeverity);

    const sourceTile = this.state.sourceTiles.get(source.id);
    if (sourceTile) updateSourceTileHealth(sourceTile, health);
    renderActiveEventSummary(this.elements, this.state.sources, this.state.sourceHealth);
  }

  updateDebouncedAlarm(source, health, severity) {
    const transition = this.alarmDebouncer.observe(source.id, health.state, severity);
    if (!transition) return;
    this.pushEvent({
      sourceId: source.id,
      sourceName: source.name,
      severity,
      message: health.detail,
    });
  }

  pushEvent(event) {
    this.state.events.unshift({
      ...event,
      id: crypto.randomUUID(),
      at: Date.now(),
    });
    this.state.events = this.state.events.slice(0, MAX_RETAINED_EVENTS);
    this.stateRepository.saveEvents(this.state.events);
    renderEventList(this.elements.eventList, this.state.events);
  }

  toggleLayoutLock() {
    this.state.layoutLocked = !this.state.layoutLocked;
    this.saveSettings();
    this.updateToolbar();
    this.updateSourcePresentation();
    this.showToast(this.state.layoutLocked ? "布局已锁定" : "布局已解锁，可以配置或拖动来源");
  }

  updateToolbar() {
    this.elements.lockButton.textContent = this.state.layoutLocked ? "已锁定布局" : "布局可调整";
    this.elements.lockButton.classList.toggle("is-active", !this.state.layoutLocked);
  }

  openSourceConfiguration(sourceId = null) {
    renderSourceConfigForm(this.elements.configFields, this.state.sources);
    this.elements.configDialog.showModal();
    if (sourceId) {
      this.elements.configFields
        .querySelector(`[data-source-id="${sourceId}"] [name="url"]`)
        ?.focus();
    }
  }

  async handleConfigurationSubmit(event) {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    if (this.savingConfiguration) return;
    const sources = readSourceConfigForm(this.elements.configFields);
    const validationErrors = validateSources(sources, this.state.sources.length);
    if (validationErrors.length) {
      this.showToast(validationErrors[0]);
      return;
    }

    this.savingConfiguration = true;
    try {
      const previousSources = this.state.sources;
      const previousById = new Map(previousSources.map((source) => [source.id, source]));
      const changedSources = sources.filter((source) => {
        const previous = previousById.get(source.id);
        return !previous || !sameSourceConfiguration(previous, source);
      });
      const nextIds = new Set(sources.map((source) => source.id));
      const changedIds = new Set(changedSources.map((source) => source.id));
      const replacedSources = previousSources.filter(
        (source) => !nextIds.has(source.id) || changedIds.has(source.id),
      );
      for (const source of replacedSources) {
        this.state.mediaSessions.get(source.id)?.dispose();
        this.state.mediaSessions.delete(source.id);
      }
      await this.stopReplacedGatewaySources(previousSources, sources);
      for (const source of replacedSources) {
        this.state.sourceTiles.get(source.id)?.root.remove();
        this.state.sourceTiles.delete(source.id);
        this.state.sourceHealth.delete(source.id);
        this.alarmDebouncer.forget(source.id);
      }
      this.state.sources = sources;
      this.saveSettings();
      this.elements.configDialog.close();
      for (const source of changedSources) {
        this.mountSource(source);
        this.state.mediaSessions.get(source.id).setMuted(source.id !== this.state.listenedSourceId);
      }
      this.updateSourceOrder();
      this.updateSourcePresentation();
      renderActiveEventSummary(this.elements, this.state.sources, this.state.sourceHealth);
      this.showToast("视频源配置已保存");
    } finally {
      this.savingConfiguration = false;
    }
  }

  stopReplacedGatewaySources(previousSources, nextSources) {
    const nextSourcesById = new Map(nextSources.map((source) => [source.id, source]));
    return Promise.all(
      previousSources.map((source) => {
        const replacement = nextSourcesById.get(source.id);
        if (
          isSupportedMediaUrl(source.url) &&
          (!replacement || replacement.url !== source.url || !isSupportedMediaUrl(replacement.url))
        ) {
          return this.gatewayClient.stopStream(source.id).catch(() => {});
        }
        return Promise.resolve();
      }),
    );
  }

  reconnectSources() {
    let reconnectCount = 0;
    for (const mediaSession of this.state.mediaSessions.values()) {
      if (mediaSession.reconnect()) reconnectCount += 1;
    }
    this.showToast(reconnectCount ? `正在重新连接 ${reconnectCount} 路信号` : "尚未配置视频地址");
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      this.showToast("当前环境无法进入全屏");
    }
  }

  updateFullscreenButton() {
    this.elements.fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  }

  openEventDrawer() {
    this.elements.eventDrawer.classList.add("is-open");
    this.elements.eventDrawer.setAttribute("aria-hidden", "false");
  }

  closeEventDrawer() {
    this.elements.eventDrawer.classList.remove("is-open");
    this.elements.eventDrawer.setAttribute("aria-hidden", "true");
  }

  clearEvents() {
    this.state.events = [];
    this.stateRepository.saveEvents(this.state.events);
    renderEventList(this.elements.eventList, this.state.events);
    this.showToast("状态记录已清空");
  }

  handleGlobalKeydown(event) {
    if (event.key !== "Escape") return;
    if (this.state.focusedSourceId) this.toggleSourceFocus(this.state.focusedSourceId);
    this.closeEventDrawer();
  }

  updateRuntimeClock() {
    this.elements.runtime.textContent = `运行 ${formatDuration((Date.now() - this.state.startedAt) / 1_000)}`;
    this.elements.clock.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  }

  async updateGatewayStatus() {
    const statusDot = this.elements.gatewayStatus.querySelector(".status-dot");
    try {
      await this.gatewayClient.checkHealth();
      this.elements.gatewayStatus.lastChild.textContent = "媒体网关在线";
      statusDot.classList.add("status-dot--online");
      statusDot.classList.remove("status-dot--offline");
    } catch {
      this.elements.gatewayStatus.lastChild.textContent = "媒体网关断开";
      statusDot.classList.add("status-dot--offline");
      statusDot.classList.remove("status-dot--online");
    }
  }

  saveSettings() {
    this.stateRepository.saveSettings({
      sources: this.state.sources,
      layoutLocked: this.state.layoutLocked,
    });
  }

  findSource(sourceId) {
    return this.state.sources.find((source) => source.id === sourceId);
  }

  showToast(message) {
    this.elements.toast.textContent = message;
    this.elements.toast.classList.add("is-visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(
      () => this.elements.toast.classList.remove("is-visible"),
      2_200,
    );
  }
}

export function sameSourceConfiguration(previous, next) {
  return (
    previous.name === next.name &&
    previous.url === next.url &&
    previous.audioExpected === next.audioExpected
  );
}
