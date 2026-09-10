import test from "node:test";
import assert from "node:assert/strict";

import {
  SOURCE_KIND,
  createDefaultSources,
  isRealtimeMediaUrl,
  isHttpMediaUrl,
  isSupportedMediaUrl,
  moveSource,
  normalizeSources,
  redactSourceUrl,
  validateSources,
} from "../../src/domain/source.js";

test("当前默认布局始终生成六路独立视频源", () => {
  const sources = createDefaultSources();
  assert.equal(sources.length, 6);
  assert.equal(new Set(sources.map((source) => source.id)).size, 6);
  assert.deepEqual(
    sources.map((source) => source.name),
    ["视频源 1", "视频源 2", "视频源 3", "视频源 4", "视频源 5", "视频源 6"],
  );
  assert.ok(sources.every((source) => source.kind === SOURCE_KIND.UNCONFIGURED));
  assert.ok(sources.every((source) => source.url === ""));
});

test("领域模型不把产品能力锁死为六路", () => {
  const sources = createDefaultSources(8);
  assert.equal(sources.length, 8);
  assert.equal(sources[7].id, "source-8");
});

test("损坏或不足的配置会恢复为目标路数", () => {
  const sources = normalizeSources([
    { id: "same", name: "主机位", kind: "video" },
    { id: "same", name: "" },
  ]);
  assert.equal(sources.length, 6);
  assert.equal(new Set(sources.map((source) => source.id)).size, 6);
  assert.equal(sources[0].name, "主机位");
  assert.equal(sources[0].kind, SOURCE_KIND.UNCONFIGURED);
  assert.equal(sources[1].name, "视频源 2");
});

test("重排只改变窗口顺序，不丢失来源", () => {
  const sources = createDefaultSources();
  const moved = moveSource(sources, "source-6", "source-2");
  assert.deepEqual(
    moved.map((source) => source.id),
    ["source-1", "source-6", "source-2", "source-3", "source-4", "source-5"],
  );
  assert.deepEqual(
    new Set(moved.map((source) => source.id)),
    new Set(sources.map((source) => source.id)),
  );
});

test("空地址表示未配置，名称重复和不支持的协议会被拒绝", () => {
  const sources = createDefaultSources();
  sources[0] = { ...sources[0], url: "", name: "重复" };
  sources[1] = { ...sources[1], name: "重复" };
  const errors = validateSources(sources);
  assert.ok(errors.some((error) => error.includes("名称重复")));
  assert.ok(!errors.some((error) => error.includes("视频 URL")));

  sources[1] = { ...sources[1], name: "第二路", url: "ftp://example.com/camera" };
  assert.ok(validateSources(sources).some((error) => error.includes("HTTP")));
});

test("识别 HTTP 地址和实时传输协议地址", () => {
  assert.equal(isHttpMediaUrl("https://media.example/live/camera.m3u8"), true);
  assert.equal(isHttpMediaUrl("http://127.0.0.1/live/camera.flv"), true);
  assert.equal(isHttpMediaUrl("rtmp://relay.example/live/camera"), false);
  assert.equal(isRealtimeMediaUrl("rtsp://192.0.2.10/live/camera"), true);
  assert.equal(isRealtimeMediaUrl("srt://relay.example:10080?streamid=live/camera"), true);
  assert.equal(isSupportedMediaUrl("rtmp://relay.example/live/camera"), true);
  assert.equal(isSupportedMediaUrl("ftp://example.com/camera"), false);
});

test("敏感地址在显示和诊断前脱敏", () => {
  const maskedUrl = redactSourceUrl("https://user:secret@example.com/live?token=abc&quality=high");
  assert.ok(!maskedUrl.includes("secret"));
  assert.ok(!maskedUrl.includes("abc"));
  assert.ok(maskedUrl.includes("quality=high"));
});
