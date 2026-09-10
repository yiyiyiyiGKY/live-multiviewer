import test from "node:test";
import assert from "node:assert/strict";

import {
  consumeDiagnostics,
  consumeProgress,
  createFfmpegMetrics,
} from "../../server/ffmpeg-metrics.js";

test("解析 FFmpeg 进度中的帧率、码率和处理速度", () => {
  const metrics = createFfmpegMetrics("libx264");
  const remainder = consumeProgress("fps=29.97\nbitrate=4321.5kbits/s\nspeed=1.02x\npar", metrics);
  assert.equal(remainder, "par");
  assert.equal(metrics.fps, 29.97);
  assert.equal(metrics.bitrateMbps, 4.3215);
  assert.equal(metrics.speed, 1.02);
  consumeProgress("bitrate=N/A\n", metrics);
  assert.equal(metrics.bitrateMbps, 4.3215);
});

test("把音频 RMS dBFS 映射成稳定的 0 到 1 电平", () => {
  const metrics = createFfmpegMetrics("libx264");
  consumeDiagnostics("frame:0\nlavfi.astats.Overall.RMS_level=-18.0\n", metrics);
  assert.equal(metrics.audioRmsDb, -18);
  assert.equal(metrics.audioLevel, 0.7);
  assert.equal(metrics.audioMeasured, true);

  consumeDiagnostics("lavfi.astats.Overall.RMS_level=-inf\n", metrics);
  assert.equal(metrics.audioRmsDb, null);
  assert.equal(metrics.audioLevel, 0);
});

test("跟踪静帧、黑场和持续静音的开始与结束", () => {
  const metrics = createFfmpegMetrics("libx264");
  consumeDiagnostics("freeze_start: 1.0\nblack_start:1 black_end:4\nsilence_start: 2\n", metrics);
  assert.equal(metrics.videoFrozen, true);
  assert.equal(metrics.videoBlack, false);
  assert.equal(metrics.audioSilent, true);

  consumeDiagnostics("freeze_end: 8.0\nsilence_end: 9.0\n", metrics);
  assert.equal(metrics.videoFrozen, false);
  assert.equal(metrics.audioSilent, false);
});
