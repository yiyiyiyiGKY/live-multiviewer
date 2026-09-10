import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = new URL("../../", import.meta.url);

test("真实媒体网关生成可播放 HLS 并同步视频与音频指标", { timeout: 35_000 }, async () => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "live-multiviewer-test-"));
  const sourceServer = await startSyntheticLiveSource();
  const gatewayPort = await reservePort();
  const gateway = spawn("node", ["server/media-gateway.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MULTIVIEWER_GATEWAY_PORT: String(gatewayPort),
      MULTIVIEWER_RUNTIME_DIR: runtimeDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let gatewayOutput = "";
  gateway.stdout.setEncoding("utf8");
  gateway.stderr.setEncoding("utf8");
  gateway.stdout.on("data", (chunk) => {
    gatewayOutput += chunk;
  });
  gateway.stderr.on("data", (chunk) => {
    gatewayOutput += chunk;
  });

  const baseUrl = `http://127.0.0.1:${gatewayPort}`;
  let latestStream = null;
  try {
    await waitFor(async () => (await fetch(`${baseUrl}/api/health`)).ok, 8_000);

    const settings = { sources: [], layoutLocked: true };
    assert.equal(
      (
        await fetch(`${baseUrl}/api/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings }),
        })
      ).status,
      200,
    );
    assert.deepEqual((await (await fetch(`${baseUrl}/api/settings`)).json()).settings, settings);

    const startResponse = await fetch(`${baseUrl}/api/streams/source-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: sourceServer.url }),
    });
    assert.equal(startResponse.status, 202);
    const { playbackUrl } = await startResponse.json();

    const stream = await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/streams/source-1`);
      if (!response.ok) return null;
      const candidate = (await response.json()).stream;
      latestStream = candidate;
      return candidate.status === "streaming" &&
        candidate.metrics.fps > 0 &&
        candidate.metrics.bitrateMbps > 0 &&
        candidate.metrics.audioLevel > 0
        ? candidate
        : null;
    }, 20_000);

    assert.equal(stream.metrics.videoCodec, "h264");
    assert.equal(stream.metrics.audioCodec, "aac");
    assert.ok(stream.metrics.audioRmsDb < 0);
    assert.ok(!JSON.stringify(stream).includes(sourceServer.url));

    const playlist = await (await fetch(playbackUrl)).text();
    const segmentName = playlist.split("\n").find((line) => line.trim() && !line.startsWith("#"));
    assert.ok(segmentName, "HLS 播放列表应包含媒体切片");
    const segmentUrl = new URL(segmentName, playbackUrl);
    const segment = Buffer.from(await (await fetch(segmentUrl)).arrayBuffer());
    const codecs = await probeCodecs(segment);
    assert.deepEqual(new Set(codecs), new Set(["h264", "aac"]));

    const sameSourcePlayback = await startGatewayStream(baseUrl, "source-2", sourceServer.url);
    const differentSourcePlayback = await startGatewayStream(
      baseUrl,
      "source-3",
      sourceServer.alternateUrl,
    );
    assert.equal(sameSourcePlayback, playbackUrl);
    assert.notEqual(differentSourcePlayback, playbackUrl);
    await Promise.all([
      waitForStreaming(baseUrl, "source-2"),
      waitForStreaming(baseUrl, "source-3"),
    ]);

    const replacementPlayback = await startGatewayStream(
      baseUrl,
      "source-1",
      sourceServer.replacementUrl,
    );
    assert.notEqual(replacementPlayback, playbackUrl);
    await waitForStreaming(baseUrl, "source-1");
    assert.equal((await fetch(playbackUrl)).status, 200);

    assert.equal(
      (await fetch(`${baseUrl}/api/streams/source-2`, { method: "DELETE" })).status,
      200,
    );
    await waitFor(async () => (await fetch(playbackUrl)).status === 404, 5_000);

    for (const sourceId of ["source-1", "source-3"]) {
      assert.equal(
        (await fetch(`${baseUrl}/api/streams/${sourceId}`, { method: "DELETE" })).status,
        200,
      );
      assert.equal((await fetch(`${baseUrl}/api/streams/${sourceId}`)).status, 404);
    }
  } catch (error) {
    error.message = `${error.message}\n最后状态：${JSON.stringify(latestStream)}\n媒体网关输出：${gatewayOutput.slice(-2_000)}`;
    throw error;
  } finally {
    gateway.kill("SIGTERM");
    await waitForProcessExit(gateway);
    await sourceServer.close();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

async function startSyntheticLiveSource() {
  const producers = new Set();
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "video/mp2t" });
    const producer = spawn(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=640x360:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=48000",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-g",
        "30",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-f",
        "mpegts",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    producers.add(producer);
    producer.stdout.pipe(response);
    producer.once("exit", () => producers.delete(producer));
    response.once("close", () => producer.kill("SIGTERM"));
  });
  await listen(server);
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/live.ts`,
    alternateUrl: `http://127.0.0.1:${address.port}/alternate.ts`,
    replacementUrl: `http://127.0.0.1:${address.port}/replacement.ts`,
    async close() {
      for (const producer of producers) producer.kill("SIGTERM");
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function startGatewayStream(baseUrl, sourceId, url) {
  const response = await fetch(`${baseUrl}/api/streams/${sourceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  assert.equal(response.status, 202);
  return (await response.json()).playbackUrl;
}

async function waitForStreaming(baseUrl, sourceId) {
  return waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/streams/${sourceId}`);
    if (!response.ok) return null;
    const stream = (await response.json()).stream;
    return stream.status === "streaming" && stream.metrics.audioLevel > 0 ? stream : null;
  }, 20_000);
}

async function probeCodecs(segment) {
  const probe = spawn(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_name", "-of", "json", "pipe:0"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  probe.stdout.setEncoding("utf8");
  probe.stderr.setEncoding("utf8");
  probe.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  probe.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  probe.stdin.end(segment);
  const exitCode = await waitForProcessExit(probe);
  assert.equal(exitCode, 0, stderr);
  return JSON.parse(stdout).streams.map((stream) => stream.codec_name);
}

async function reservePort() {
  const server = createServer();
  await listen(server);
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latestError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      latestError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw latestError ?? new Error(`等待 ${timeoutMs}ms 后仍未满足条件`);
}

async function waitForProcessExit(child) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve) => child.once("exit", resolve));
}
