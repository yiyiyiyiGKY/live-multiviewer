import test from "node:test";
import assert from "node:assert/strict";
import Hls from "hls.js";

import {
  HLS_PLAYBACK_CONFIG,
  createHlsAdapter,
} from "../../src/media/playback/create-playback-adapter.js";
import { PLAYBACK_ENGINE } from "../../src/media/media-url.js";

test("hls.js 接受监看配置：限制缓冲、关闭卡顿后目标延迟递增", () => {
  const hls = new Hls(HLS_PLAYBACK_CONFIG);
  try {
    assert.equal(hls.config.liveSyncDurationCount, 2);
    assert.equal(hls.config.liveMaxLatencyDurationCount, 5);
    assert.equal(hls.config.liveSyncOnStallIncrease, 0);
    assert.equal(hls.config.maxLiveSyncPlaybackRate, 1.1);
    assert.equal(hls.config.maxBufferLength, 4);
    assert.equal(hls.config.backBufferLength, 6);
  } finally {
    hls.destroy();
  }
});

test("浏览器宣称支持原生 HLS 时仍优先使用可用的 hls.js", () => {
  let created = 0;
  class SupportedHls {
    static Events = { ERROR: "error" };
    static isSupported() {
      return true;
    }
    constructor() {
      created += 1;
    }
    on() {}
    destroy() {}
  }

  const adapter = createHlsAdapter({
    Hls: SupportedHls,
    url: "http://127.0.0.1/live.m3u8",
    video: { canPlayType: () => "maybe" },
    onFatalError() {},
    onWarning() {},
  });
  assert.equal(adapter.engine, PLAYBACK_ENGINE.HLS);
  assert.equal(created, 1);
  adapter.destroy();
});

test("hls.js 不可用时保留原生 HLS 回退", () => {
  class UnsupportedHls {
    static isSupported() {
      return false;
    }
  }
  const adapter = createHlsAdapter({
    Hls: UnsupportedHls,
    url: "http://127.0.0.1/live.m3u8",
    video: { canPlayType: () => "maybe" },
    onFatalError() {},
    onWarning() {},
  });
  assert.equal(adapter.engine, PLAYBACK_ENGINE.NATIVE_VIDEO);
});
