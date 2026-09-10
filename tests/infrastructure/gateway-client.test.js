import test from "node:test";
import assert from "node:assert/strict";

import { GatewayClient } from "../../src/infrastructure/gateway-client.js";

const location = { hostname: "127.0.0.1" };

test("不同协议都通过同一媒体网关转换成 HLS", async () => {
  let request;
  const client = new GatewayClient({
    location,
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({ playbackUrl: "http://127.0.0.1:4174/media/source-1/index.m3u8" }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  for (const url of [
    "https://media.example/live/camera.m3u8",
    "rtsp://192.0.2.10:8554/live/camera1",
    "rtmp://media.example/live/camera",
    "srt://relay.example:10080?streamid=live/camera",
  ]) {
    const playbackUrl = await client.resolvePlaybackUrl({ id: "source-1", url });
    assert.equal(playbackUrl, "http://127.0.0.1:4174/media/source-1/index.m3u8");
    assert.equal(request.url, "http://127.0.0.1:4174/api/streams/source-1");
    assert.equal(request.options.method, "POST");
    assert.equal(JSON.parse(request.options.body).url, url);
  }
});

test("读取单路网关状态和实时指标", async () => {
  const client = new GatewayClient({
    location,
    fetchImplementation: async () =>
      new Response(
        JSON.stringify({
          stream: {
            sourceId: "source-1",
            status: "streaming",
            metrics: { fps: 30, bitrateMbps: 4.2, audioLevel: 0.55 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  const status = await client.getStreamStatus("source-1");
  assert.equal(status.status, "streaming");
  assert.equal(status.metrics.audioLevel, 0.55);
});

test("网关健康、公共配置保存读取和停止使用明确接口", async () => {
  const requests = [];
  const client = new GatewayClient({
    location,
    fetchImplementation: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith("/api/health")) return Response.json({ status: "ok", streams: [] });
      if (url.endsWith("/api/settings") && options.method === "PUT") {
        return Response.json({ saved: true });
      }
      if (url.endsWith("/api/settings")) {
        return Response.json({ settings: { sources: [], layoutLocked: true } });
      }
      return Response.json({ stopped: true });
    },
  });

  assert.equal((await client.checkHealth()).status, "ok");
  assert.equal((await client.loadSettings()).layoutLocked, true);
  await client.saveSettings({ sources: [], layoutLocked: false });
  await client.stopStream("source-1");

  assert.ok(requests.some(({ options }) => options.method === "PUT"));
  assert.ok(requests.some(({ options }) => options.method === "DELETE"));
});

test("网关拒绝来源时返回可读错误", async () => {
  const client = new GatewayClient({
    location,
    fetchImplementation: async () => Response.json({ error: "来源地址不可用" }, { status: 400 }),
  });
  await assert.rejects(
    client.resolvePlaybackUrl({ id: "source-1", url: "rtmp://media.example/missing" }),
    /来源地址不可用/,
  );
});
