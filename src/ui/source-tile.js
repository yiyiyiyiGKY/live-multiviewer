import { SOURCE_KIND, redactSourceUrl } from "../domain/source.js";

const MONITOR_STATE_CLASSES = [
  "is-unconfigured",
  "is-online",
  "is-warning",
  "is-offline",
  "is-connecting",
];

export function createSourceTile(source, callbacks) {
  const root = document.createElement("article");
  root.className = "source-tile is-connecting";
  root.dataset.sourceId = source.id;
  root.tabIndex = 0;
  root.draggable = !callbacks.isLayoutLocked();
  root.setAttribute("aria-label", `${source.name} 视频窗口`);

  const header = document.createElement("header");
  header.className = "source-header";
  const name = document.createElement("h2");
  name.className = "source-name";
  name.textContent = source.name;
  const status = document.createElement("span");
  status.className = "source-status";
  status.textContent = source.kind === SOURCE_KIND.UNCONFIGURED ? "未配置" : "连接中";
  const configureButton = document.createElement("button");
  configureButton.className = "source-configure-button";
  configureButton.type = "button";
  configureButton.textContent = "设置";
  configureButton.setAttribute("aria-label", `设置 ${source.name}`);
  configureButton.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onConfigure(source.id);
  });
  const headerActions = document.createElement("div");
  headerActions.className = "source-header-actions";
  headerActions.append(status, configureButton);
  header.append(name, headerActions);

  const mediaHost = document.createElement("div");
  mediaHost.className = "media-host";
  const emptyState = document.createElement("div");
  emptyState.className = "source-empty-state";
  const emptyTitle = document.createElement("strong");
  emptyTitle.textContent = "未配置视频地址";
  const emptyButton = document.createElement("button");
  emptyButton.className = "button button--quiet";
  emptyButton.type = "button";
  emptyButton.textContent = "填写地址";
  emptyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onConfigure(source.id);
  });
  emptyState.append(emptyTitle, emptyButton);
  const signalMessage = document.createElement("p");
  signalMessage.className = "source-signal-message";
  mediaHost.append(emptyState, signalMessage);

  const metadata = document.createElement("div");
  metadata.className = "source-metadata";
  const detail = document.createElement("p");
  detail.className = "source-detail";
  detail.textContent = redactSourceUrl(source.url);
  const audioRow = document.createElement("div");
  audioRow.className = "audio-row";
  const audioLabel = document.createElement("span");
  audioLabel.textContent = "AUDIO";
  const audioMeter = document.createElement("span");
  audioMeter.className = "audio-meter";
  const audioMeterFill = document.createElement("i");
  audioMeter.append(audioMeterFill);
  const listeningBadge = document.createElement("span");
  listeningBadge.className = "listening-badge";
  listeningBadge.textContent = "监听";
  audioRow.append(audioLabel, audioMeter, listeningBadge);
  metadata.append(detail, audioRow);
  root.append(header, mediaHost, metadata);

  let selectTimer = null;
  root.addEventListener("click", () => {
    window.clearTimeout(selectTimer);
    selectTimer = window.setTimeout(() => callbacks.onSelect(source.id), 220);
  });
  root.addEventListener("dblclick", () => {
    window.clearTimeout(selectTimer);
    callbacks.onFocus(source.id);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter") callbacks.onFocus(source.id);
    if (event.key === " ") {
      event.preventDefault();
      callbacks.onSelect(source.id);
    }
  });
  root.addEventListener("dragstart", (event) => {
    if (callbacks.isLayoutLocked()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", source.id);
  });
  root.addEventListener("dragover", (event) => {
    if (!callbacks.isLayoutLocked()) event.preventDefault();
  });
  root.addEventListener("drop", (event) => {
    event.preventDefault();
    if (callbacks.isLayoutLocked()) return;
    callbacks.onMove(event.dataTransfer.getData("text/plain"), source.id);
  });

  return { root, mediaHost, status, detail, audioMeterFill, listeningBadge, signalMessage };
}

export function updateSourceTileHealth(sourceTile, health) {
  sourceTile.root.classList.remove(...MONITOR_STATE_CLASSES);
  sourceTile.root.classList.add(`is-${health.state}`);
  sourceTile.status.textContent = health.label;
  const bitrate = health.bitrate ? `${health.bitrate.toFixed(1)} Mb/s` : "-- Mb/s";
  const frameRate = Number.isFinite(health.fps) && health.fps > 0 ? health.fps.toFixed(1) : "--";
  sourceTile.detail.textContent =
    health.state === "unconfigured"
      ? health.detail
      : `${health.protocol}  预览 ${health.resolution}  ${frameRate} fps  ${bitrate}`;
  sourceTile.signalMessage.textContent = health.detail;
  sourceTile.audioMeterFill.style.transform = `scaleX(${clamp(health.audioLevel, 0, 1)})`;
  sourceTile.audioMeterFill.parentElement.title = Number.isFinite(health.audioRmsDb)
    ? `${health.audioRmsDb.toFixed(1)} dBFS`
    : health.audioMeasured
      ? "静音（-∞ dBFS）"
      : "等待音频电平";
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
