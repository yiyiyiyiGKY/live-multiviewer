import { MONITOR_STATE } from "../domain/monitor-health.js";
import { SOURCE_KIND } from "../domain/source.js";
import { PLAYBACK_ENGINE } from "./media-url.js";
import { createPlaybackAdapter } from "./playback/create-playback-adapter.js";

const VIDEO_HEALTH_UPDATE_INTERVAL_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const STALLED_WARNING_SECONDS = 5;
const STALLED_RECONNECT_SECONDS = 15;
const GATEWAY_STATUS_POLL_INTERVAL_MS = 500;

export class SourceMediaSession {
  constructor(source, onHealthChange, gatewayClient) {
    this.source = source;
    this.onHealthChange = onHealthChange;
    this.gatewayClient = gatewayClient;
    this.mediaElement = null;
    this.playbackAdapter = null;
    this.healthTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.lastVideoTime = -1;
    this.lastProgressAt = 0;
    this.lastDecodedFrameCount = null;
    this.lastFrameSampleAt = 0;
    this.measuredFps = null;
    this.gatewayMetrics = null;
    this.gatewayPollInFlight = false;
    this.connectionGeneration = 0;
  }

  mount(container) {
    this.dispose();
    if (this.source.kind === SOURCE_KIND.VIDEO_URL) this.mountVideo(container);
    else this.emitUnconfigured();
  }

  emitUnconfigured() {
    this.emitHealth({
      state: MONITOR_STATE.UNCONFIGURED,
      label: "未配置",
      detail: "尚未填写视频地址",
      protocol: "--",
      resolution: "--",
      fps: null,
      bitrate: null,
      audioLevel: 0,
    });
  }

  mountVideo(container) {
    const video = document.createElement("video");
    video.className = "media-element";
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.preload = "auto";
    container.append(video);
    this.mediaElement = video;
    this.installVideoListeners(video);
    this.connectVideo();
    this.healthTimer = window.setInterval(
      () => this.pollVideoHealth(),
      VIDEO_HEALTH_UPDATE_INTERVAL_MS,
    );
  }

  installVideoListeners(video) {
    video.addEventListener("loadstart", () => this.emitConnecting("正在建立视频连接"));
    video.addEventListener("playing", () => {
      this.reconnectAttempt = 0;
      this.lastVideoTime = video.currentTime;
      this.lastProgressAt = performance.now();
      this.emitVideoHealth(MONITOR_STATE.ONLINE, "在线", "视频正在播放");
    });
    video.addEventListener("waiting", () => {
      this.emitVideoHealth(MONITOR_STATE.WARNING, "缓冲", "等待新的视频数据");
    });
    video.addEventListener("stalled", () => {
      this.emitVideoHealth(MONITOR_STATE.WARNING, "停滞", "视频下载已停滞");
    });
    video.addEventListener("error", () => {
      if (this.playbackAdapter?.engine === PLAYBACK_ENGINE.NATIVE_VIDEO) {
        this.handleVideoError("浏览器无法读取该媒体地址或编码");
      }
    });
  }

  async connectVideo() {
    if (!(this.mediaElement instanceof HTMLVideoElement)) return;
    const connectionGeneration = ++this.connectionGeneration;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.destroyPlaybackAdapter();
    this.lastVideoTime = -1;
    this.lastProgressAt = performance.now();
    this.lastDecodedFrameCount = null;
    this.lastFrameSampleAt = 0;
    this.measuredFps = null;
    this.gatewayMetrics = null;
    this.emitConnecting(`正在连接 ${describeSourceProtocol(this.source.url)}`);

    try {
      const playbackUrl = await this.gatewayClient.resolvePlaybackUrl(this.source);
      await this.waitForGatewayReady(connectionGeneration);
      if (connectionGeneration !== this.connectionGeneration || !this.mediaElement) return;
      const playbackAdapter = await createPlaybackAdapter({
        url: playbackUrl,
        video: this.mediaElement,
        onFatalError: (detail) => this.handleVideoError(detail),
        onWarning: (detail) => this.emitVideoHealth(MONITOR_STATE.WARNING, "等待", detail),
      });
      if (connectionGeneration !== this.connectionGeneration || !this.mediaElement) {
        playbackAdapter.destroy();
        return;
      }
      this.playbackAdapter = playbackAdapter;
      playbackAdapter.start();
    } catch (error) {
      if (connectionGeneration !== this.connectionGeneration) return;
      this.handleVideoError(error instanceof Error ? error.message : "播放器初始化失败");
    }
  }

  async waitForGatewayReady(connectionGeneration) {
    while (connectionGeneration === this.connectionGeneration && this.mediaElement) {
      try {
        const stream = await this.gatewayClient.getStreamStatus(this.source.id);
        this.gatewayMetrics = stream.metrics ?? null;
        if (stream.status === "streaming") return;
        if (stream.status === "reconnecting") {
          this.emitVideoHealth(
            MONITOR_STATE.OFFLINE,
            "重连中",
            readableGatewayError(stream.lastError),
          );
        } else {
          this.emitVideoHealth(MONITOR_STATE.CONNECTING, "连接中", "等待来源输出画面");
        }
      } catch (error) {
        this.emitVideoHealth(
          MONITOR_STATE.OFFLINE,
          "网关断开",
          error instanceof Error ? error.message : "无法读取媒体网关状态",
        );
      }
      await delay(GATEWAY_STATUS_POLL_INTERVAL_MS);
    }
  }

  handleVideoError(errorDetail = "媒体连接失败") {
    if (!this.mediaElement || this.reconnectTimer) return;
    this.connectionGeneration += 1;
    this.destroyPlaybackAdapter();
    const reconnectDelay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.emitVideoHealth(
      MONITOR_STATE.OFFLINE,
      "断开",
      `${errorDetail}；${Math.round(reconnectDelay / 1_000)} 秒后重连`,
    );
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectVideo();
    }, reconnectDelay);
  }

  pollVideoHealth() {
    if (!(this.mediaElement instanceof HTMLVideoElement) || this.reconnectTimer) return;
    this.pollGatewayHealth();
    const video = this.mediaElement;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.sampleFrameRate(video);

    if (Math.abs(video.currentTime - this.lastVideoTime) > 0.01) {
      this.lastVideoTime = video.currentTime;
      this.lastProgressAt = performance.now();
      if (!video.paused) this.emitVideoHealth(MONITOR_STATE.ONLINE, "在线", "视频正在播放");
      return;
    }

    const stalledSeconds = Math.floor((performance.now() - this.lastProgressAt) / 1_000);
    if (stalledSeconds >= STALLED_RECONNECT_SECONDS) {
      this.handleVideoError(`连续 ${STALLED_RECONNECT_SECONDS} 秒没有新画面`);
    } else if (stalledSeconds >= STALLED_WARNING_SECONDS) {
      this.emitVideoHealth(MONITOR_STATE.WARNING, "静帧", `${stalledSeconds} 秒没有新画面`);
    }
  }

  async pollGatewayHealth() {
    if (this.gatewayPollInFlight) return;
    const connectionGeneration = this.connectionGeneration;
    this.gatewayPollInFlight = true;
    try {
      const stream = await this.gatewayClient.getStreamStatus(this.source.id);
      if (connectionGeneration !== this.connectionGeneration || !this.mediaElement) return;
      this.gatewayMetrics = stream.metrics ?? null;
      if (stream.status === "reconnecting") {
        this.emitVideoHealth(
          MONITOR_STATE.OFFLINE,
          "重连中",
          readableGatewayError(stream.lastError),
        );
      } else if (stream.status !== "streaming") {
        this.emitVideoHealth(MONITOR_STATE.CONNECTING, "连接中", "等待来源输出画面");
      }
    } catch {
      // 播放器自身状态仍可继续判断，避免一次状态请求失败遮蔽正在播放的画面。
    } finally {
      this.gatewayPollInFlight = false;
    }
  }

  reconnect() {
    if (this.source.kind !== SOURCE_KIND.VIDEO_URL) return false;
    this.reconnectAttempt = 0;
    this.connectVideo();
    return true;
  }

  sampleFrameRate(video) {
    const quality = video.getVideoPlaybackQuality?.();
    if (!quality) return;
    const sampledAt = performance.now();
    if (this.lastDecodedFrameCount !== null && this.lastFrameSampleAt) {
      const elapsedSeconds = (sampledAt - this.lastFrameSampleAt) / 1_000;
      const decodedFrames = quality.totalVideoFrames - this.lastDecodedFrameCount;
      if (elapsedSeconds >= 0.5 && decodedFrames >= 0) {
        this.measuredFps = decodedFrames / elapsedSeconds;
      }
    }
    this.lastDecodedFrameCount = quality.totalVideoFrames;
    this.lastFrameSampleAt = sampledAt;
  }

  emitConnecting(detail) {
    this.emitHealth({
      state: MONITOR_STATE.CONNECTING,
      label: "连接中",
      detail,
      protocol: describeSourceProtocol(this.source.url),
      resolution: "--",
      fps: null,
      bitrate: null,
      audioLevel: 0,
    });
  }

  emitVideoHealth(state, label, detail) {
    const video = this.mediaElement;
    const analyzedHealth = this.applySignalAnalysis(state, label, detail);
    const resolution =
      video instanceof HTMLVideoElement && video.videoWidth
        ? `${video.videoWidth}×${video.videoHeight}`
        : "--";
    this.emitHealth({
      ...analyzedHealth,
      protocol: describeSourceProtocol(this.source.url),
      resolution,
      fps: this.measuredFps ?? this.gatewayMetrics?.fps ?? null,
      bitrate: this.gatewayMetrics?.bitrateMbps ?? this.playbackAdapter?.getBitrateMbps() ?? null,
      audioLevel: this.gatewayMetrics?.audioLevel ?? 0,
      audioRmsDb: this.gatewayMetrics?.audioRmsDb ?? null,
      audioMeasured: this.gatewayMetrics?.audioMeasured ?? false,
    });
  }

  applySignalAnalysis(state, label, detail) {
    if (state !== MONITOR_STATE.ONLINE) return { state, label, detail };
    if (this.gatewayMetrics?.videoFrozen) {
      return { state: MONITOR_STATE.WARNING, label: "静帧", detail: "画面内容持续静止" };
    }
    if (this.gatewayMetrics?.videoBlack) {
      return { state: MONITOR_STATE.WARNING, label: "黑场", detail: "画面持续接近全黑" };
    }
    if (this.source.audioExpected && this.gatewayMetrics?.audioSilent) {
      return { state: MONITOR_STATE.WARNING, label: "静音", detail: "音频持续低于 -50 dBFS" };
    }
    return { state, label, detail };
  }

  emitHealth(health) {
    this.onHealthChange({ ...health, updatedAt: Date.now() });
  }

  setMuted(muted) {
    if (this.mediaElement instanceof HTMLVideoElement) this.mediaElement.muted = muted;
  }

  dispose() {
    this.connectionGeneration += 1;
    if (this.healthTimer) window.clearInterval(this.healthTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.destroyPlaybackAdapter();
    this.mediaElement?.remove();
    this.mediaElement = null;
    this.healthTimer = null;
    this.reconnectTimer = null;
  }

  destroyPlaybackAdapter() {
    this.playbackAdapter?.destroy();
    this.playbackAdapter = null;
  }
}

function describeSourceProtocol(value) {
  try {
    return `${new URL(value).protocol.slice(0, -1).toUpperCase()}→HLS`;
  } catch {
    return "URL→HLS";
  }
}

function readableGatewayError(value) {
  if (!value) return "来源暂时没有输出，媒体网关正在重试";
  if (/404 Not Found/i.test(value)) return "来源不存在或尚未开始推流，正在重试";
  if (/Connection refused/i.test(value)) return "来源拒绝连接，正在重试";
  if (/timed? out/i.test(value)) return "来源连接超时，正在重试";
  if (/Server error/i.test(value)) return "来源服务器返回错误，正在重试";
  return "来源中断，媒体网关正在重试";
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
