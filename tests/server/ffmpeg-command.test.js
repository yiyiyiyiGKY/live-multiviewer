import test from "node:test";
import assert from "node:assert/strict";

import { createFfmpegArguments } from "../../server/ffmpeg-command.js";

test("所有输入统一转为软件 H.264、AAC 和一秒关键帧", () => {
  const argumentsList = createFfmpegArguments(
    "rtmp://media.example/live/camera",
    "/tmp/live-multiviewer-test",
    "libx264",
  );
  assert.ok(includesSequence(argumentsList, ["-c:v", "libx264"]));
  assert.ok(includesSequence(argumentsList, ["-c:a", "aac"]));
  assert.ok(includesSequence(argumentsList, ["-ar", "48000"]));
  assert.ok(includesSequence(argumentsList, ["-ac", "2"]));
  assert.ok(includesSequence(argumentsList, ["-force_key_frames", "expr:gte(t,n_forced*1)"]));
  assert.ok(
    argumentsList.includes(
      "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=pipe\\\\:2,silencedetect=noise=-50dB:d=3",
    ),
  );
  assert.ok(
    argumentsList.includes(
      "fps=30,scale=w='min(1280,iw)':h=-2:flags=fast_bilinear,freezedetect=n=-50dB:d=5,blackdetect=d=3:pix_th=0.10",
    ),
  );
  assert.ok(includesSequence(argumentsList, ["-progress", "pipe:1"]));
});

test("可使用 VideoToolbox 硬件编码但保持相同输出约束", () => {
  const argumentsList = createFfmpegArguments(
    "https://media.example/live/camera.m3u8",
    "/tmp/live-multiviewer-test",
    "h264_videotoolbox",
  );
  assert.ok(includesSequence(argumentsList, ["-c:v", "h264_videotoolbox"]));
  assert.ok(includesSequence(argumentsList, ["-b:v", "3M"]));
  assert.ok(includesSequence(argumentsList, ["-c:a", "aac"]));
});

test("RTSP 输入使用 TCP 和墙钟时间戳，RTMP 不使用", () => {
  const rtspArguments = createFfmpegArguments(
    "rtsp://192.0.2.10/live/camera",
    "/tmp/live-multiviewer-test",
    "libx264",
  );
  const rtmpArguments = createFfmpegArguments(
    "rtmp://media.example/live/camera",
    "/tmp/live-multiviewer-test",
    "libx264",
  );
  assert.ok(includesSequence(rtspArguments, ["-rtsp_transport", "tcp"]));
  assert.ok(includesSequence(rtspArguments, ["-rw_timeout", "10000000"]));
  assert.ok(rtspArguments.includes("-use_wallclock_as_timestamps"));
  assert.ok(includesSequence(rtmpArguments, ["-rw_timeout", "10000000"]));
  assert.ok(!rtmpArguments.includes("-use_wallclock_as_timestamps"));
});

function includesSequence(values, sequence) {
  return values.some((value, index) =>
    sequence.every((item, offset) => values[index + offset] === item),
  );
}
