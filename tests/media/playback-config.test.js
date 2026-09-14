import test from "node:test";
import assert from "node:assert/strict";
import Hls from "hls.js";

import { HLS_PLAYBACK_CONFIG } from "../../src/media/playback/create-playback-adapter.js";

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
