import test from "node:test";
import assert from "node:assert/strict";

import { MONITOR_STATE } from "../../src/domain/monitor-health.js";
import { SOURCE_KIND } from "../../src/domain/source.js";
import { SourceMediaSession } from "../../src/media/source-media-session.js";

class FakeVideoElement extends EventTarget {
  constructor() {
    super();
    this.autoplay = false;
    this.playsInline = false;
    this.muted = false;
    this.paused = true;
    this.preload = "";
    this.readyState = 4;
    this.currentTime = 0;
    this.videoWidth = 1920;
    this.videoHeight = 1080;
    this.totalVideoFrames = 0;
    this.src = "";
  }

  load() {
    this.dispatchEvent(new Event("loadstart"));
  }

  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }

  pause() {
    this.paused = true;
  }

  removeAttribute(name) {
    if (name === "src") this.src = "";
  }

  getVideoPlaybackQuality() {
    return { totalVideoFrames: this.totalVideoFrames };
  }

  remove() {
    this.removed = true;
  }
}

globalThis.HTMLVideoElement = FakeVideoElement;
globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 };
globalThis.document = { createElement: () => new FakeVideoElement() };
globalThis.window = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout,
  clearTimeout,
};

function createSession(audioExpected = true) {
  return new SourceMediaSession(
    {
      id: "source-1",
      kind: SOURCE_KIND.VIDEO_URL,
      url: "rtmp://media.example/live",
      audioExpected,
    },
    () => {},
    {},
  );
}

test("统一信号分析按静帧、黑场、静音顺序提升告警", () => {
  const session = createSession();
  session.gatewayMetrics = { videoFrozen: true, videoBlack: true, audioSilent: true };
  assert.deepEqual(session.applySignalAnalysis(MONITOR_STATE.ONLINE, "在线", "视频正在播放"), {
    state: MONITOR_STATE.WARNING,
    label: "静帧",
    detail: "画面内容持续静止",
  });

  session.gatewayMetrics.videoFrozen = false;
  assert.equal(
    session.applySignalAnalysis(MONITOR_STATE.ONLINE, "在线", "视频正在播放").label,
    "黑场",
  );
  session.gatewayMetrics.videoBlack = false;
  assert.equal(
    session.applySignalAnalysis(MONITOR_STATE.ONLINE, "在线", "视频正在播放").label,
    "静音",
  );
});

test("没有音频预期的来源不触发静音告警", () => {
  const session = createSession(false);
  session.gatewayMetrics = { videoFrozen: false, videoBlack: false, audioSilent: true };
  assert.deepEqual(session.applySignalAnalysis(MONITOR_STATE.ONLINE, "在线", "视频正在播放"), {
    state: MONITOR_STATE.ONLINE,
    label: "在线",
    detail: "视频正在播放",
  });
});

test("真实媒体会话等待网关就绪后播放并上报同一组指标", async () => {
  const healthUpdates = [];
  const gatewayClient = {
    async resolvePlaybackUrl() {
      return "https://media.example/live/camera.mp4";
    },
    async getStreamStatus() {
      return {
        status: "streaming",
        metrics: {
          fps: 30,
          bitrateMbps: 4.2,
          audioLevel: 0.5,
          audioRmsDb: -30,
          audioMeasured: true,
        },
      };
    },
  };
  const session = new SourceMediaSession(
    {
      id: "source-1",
      kind: SOURCE_KIND.VIDEO_URL,
      url: "rtmp://media.example/live",
      audioExpected: true,
    },
    (health) => healthUpdates.push(health),
    gatewayClient,
  );
  const container = { append: (video) => (container.video = video) };

  session.mount(container);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(container.video.src, "https://media.example/live/camera.mp4");
  assert.equal(healthUpdates.at(-1).state, MONITOR_STATE.ONLINE);
  assert.equal(healthUpdates.at(-1).resolution, "1920×1080");
  assert.equal(healthUpdates.at(-1).bitrate, 4.2);
  assert.equal(healthUpdates.at(-1).audioLevel, 0.5);

  session.setMuted(false);
  assert.equal(container.video.muted, false);
  session.dispose();
  assert.equal(container.video.removed, true);
});

test("未配置与网关失败都返回可区分的健康状态", async () => {
  const unconfiguredHealth = [];
  const unconfigured = new SourceMediaSession(
    { id: "source-1", kind: SOURCE_KIND.UNCONFIGURED, url: "", audioExpected: true },
    (health) => unconfiguredHealth.push(health),
    {},
  );
  unconfigured.mount({});
  assert.equal(unconfiguredHealth.at(-1).state, MONITOR_STATE.UNCONFIGURED);

  const failedHealth = [];
  const failed = new SourceMediaSession(
    {
      id: "source-2",
      kind: SOURCE_KIND.VIDEO_URL,
      url: "rtmp://media.example/missing",
      audioExpected: true,
    },
    (health) => failedHealth.push(health),
    { resolvePlaybackUrl: async () => Promise.reject(new Error("媒体网关不可用")) },
  );
  failed.mount({ append: () => {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failedHealth.at(-1).state, MONITOR_STATE.OFFLINE);
  assert.match(failedHealth.at(-1).detail, /媒体网关不可用/);
  failed.dispose();
});
