import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAYBACK_ENGINE,
  classifyMediaUrl,
  describePlaybackProtocol,
} from "../../src/media/media-url.js";

test("根据网址选择对应播放引擎", () => {
  assert.equal(
    classifyMediaUrl("https://media.example/live/camera.m3u8?token=secret"),
    PLAYBACK_ENGINE.HLS,
  );
  assert.equal(classifyMediaUrl("http://media.example/live/camera.flv"), PLAYBACK_ENGINE.HTTP_FLV);
  assert.equal(
    classifyMediaUrl("http://media.example/live/camera.ts"),
    PLAYBACK_ENGINE.HTTP_MPEG_TS,
  );
  assert.equal(
    classifyMediaUrl("https://media.example/archive/camera.mp4"),
    PLAYBACK_ENGINE.NATIVE_VIDEO,
  );
});

test("显示对导播有意义的播放协议", () => {
  assert.equal(describePlaybackProtocol("https://media.example/live/camera.m3u8"), "HLS");
  assert.equal(describePlaybackProtocol("http://media.example/live/camera.flv"), "HTTP-FLV");
});
