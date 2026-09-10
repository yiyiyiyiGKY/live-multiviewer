import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createFfmpegArguments, detectH264Encoder } from "./ffmpeg-command.js";
import { consumeDiagnostics, consumeProgress, createFfmpegMetrics } from "./ffmpeg-metrics.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = resolve(process.env.MULTIVIEWER_RUNTIME_DIR ?? join(projectRoot, ".runtime"));
const mediaRoot = join(runtimeRoot, "media");
const settingsPath = join(runtimeRoot, "settings.json");
const host = process.env.MULTIVIEWER_GATEWAY_HOST ?? "127.0.0.1";
const port = Number(process.env.MULTIVIEWER_GATEWAY_PORT ?? 4174);
const allowedProtocols = new Set(["http:", "https:", "rtsp:", "rtmp:", "srt:"]);
const streams = new Map();
const h264Encoder = await detectH264Encoder();

await rm(mediaRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(mediaRoot, { recursive: true });

const server = createServer(async (request, response) => {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok", streams: getStreamStatuses() });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/settings") {
      sendJson(response, 200, { settings: await readSettings() });
      return;
    }
    if (request.method === "PUT" && requestUrl.pathname === "/api/settings") {
      const body = await readJsonBody(request);
      await writeSettings(body.settings);
      sendJson(response, 200, { saved: true });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/streams") {
      sendJson(response, 200, { streams: getStreamStatuses() });
      return;
    }

    const streamMatch = requestUrl.pathname.match(/^\/api\/streams\/([a-zA-Z0-9_-]+)$/);
    if (streamMatch && request.method === "GET") {
      const stream = getStreamStatus(streamMatch[1]);
      if (!stream) throw httpError(404, "视频源尚未启动");
      sendJson(response, 200, { stream });
      return;
    }
    if (streamMatch && request.method === "POST") {
      const sourceId = streamMatch[1];
      const inputUrl = validateGatewayInput((await readJsonBody(request)).url);
      const session = startStream(sourceId, inputUrl);
      sendJson(response, 202, {
        stream: serializeStream(sourceId, session),
        playbackUrl: `http://${request.headers.host ?? `${host}:${port}`}/media/${session.mediaId}/index.m3u8`,
      });
      return;
    }
    if (streamMatch && request.method === "DELETE") {
      stopStream(streamMatch[1]);
      sendJson(response, 200, { stopped: true });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname.startsWith("/media/")) {
      await serveMediaFile(requestUrl.pathname, response);
      return;
    }
    sendJson(response, 404, { error: "接口不存在" });
  } catch (error) {
    sendJson(response, error.statusCode ?? 500, { error: error.message ?? "媒体网关内部错误" });
  }
});

server.listen(port, host, () => console.log(`Media gateway listening on http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => shutdown(signal));

function startStream(sourceId, inputUrl) {
  const existingSession = streams.get(sourceId);
  if (existingSession?.inputUrl === inputUrl && existingSession.shouldRun) return existingSession;
  if (existingSession) stopStream(sourceId);

  const sharedSession = [...new Set(streams.values())].find(
    (session) => session.inputUrl === inputUrl && session.shouldRun,
  );
  if (sharedSession) {
    sharedSession.sourceIds.add(sourceId);
    streams.set(sourceId, sharedSession);
    return sharedSession;
  }

  const session = {
    sourceIds: new Set([sourceId]),
    mediaId: `${sourceId}-${Date.now().toString(36)}`,
    inputUrl,
    outputDirectory: null,
    process: null,
    restartTimer: null,
    healthTimer: null,
    restartAttempt: 0,
    streamingSince: null,
    shouldRun: true,
    status: "starting",
    lastError: null,
    metrics: createFfmpegMetrics(h264Encoder),
    seenSegments: new Set(),
    lastSegmentSampleAt: null,
    bitrateSampleInFlight: false,
  };
  streams.set(sourceId, session);
  launchFfmpeg(session).catch((error) => scheduleRestart(session, error.message));
  return session;
}

async function launchFfmpeg(session) {
  if (!session.shouldRun) return;
  const outputDirectory = join(mediaRoot, session.mediaId);
  session.outputDirectory = outputDirectory;
  await mkdir(outputDirectory, { recursive: true });
  if (!session.shouldRun) return;

  session.status = session.restartAttempt > 0 ? "reconnecting" : "connecting";
  session.metrics = createFfmpegMetrics(h264Encoder);
  const ffmpeg = spawn(
    "ffmpeg",
    createFfmpegArguments(session.inputUrl, outputDirectory, h264Encoder),
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  session.process = ffmpeg;
  let latestError = "";
  let progressBuffer = "";
  let diagnosticsBuffer = "";

  ffmpeg.stdout.setEncoding("utf8");
  ffmpeg.stdout.on("data", (chunk) => {
    progressBuffer = consumeProgress(`${progressBuffer}${chunk}`, session.metrics);
  });
  ffmpeg.stderr.setEncoding("utf8");
  ffmpeg.stderr.on("data", (chunk) => {
    latestError = `${latestError}${chunk}`.slice(-2_000);
    diagnosticsBuffer = consumeDiagnostics(`${diagnosticsBuffer}${chunk}`, session.metrics);
  });
  session.healthTimer = setInterval(() => {
    if (!existsSync(join(outputDirectory, "index.m3u8"))) return;
    sampleOutputBitrate(session, outputDirectory);
    if (session.status !== "streaming") session.streamingSince = Date.now();
    session.status = "streaming";
    session.lastError = null;
    if (Date.now() - session.streamingSince >= 30_000) session.restartAttempt = 0;
  }, 250);
  ffmpeg.once("error", (error) => {
    session.lastError = error.message;
  });
  ffmpeg.once("exit", () => {
    clearInterval(session.healthTimer);
    session.healthTimer = null;
    session.process = null;
    if (!session.shouldRun) {
      cleanupSessionMedia(session);
      return;
    }
    scheduleRestart(session, summarizeFfmpegError(latestError));
  });
}

async function sampleOutputBitrate(session, outputDirectory) {
  if (session.bitrateSampleInFlight) return;
  session.bitrateSampleInFlight = true;
  try {
    const segmentNames = (await readdir(outputDirectory)).filter((name) => name.endsWith(".ts"));
    const newSegmentNames = segmentNames.filter((name) => !session.seenSegments.has(name));
    const sampledAt = Date.now();
    if (!newSegmentNames.length) return;

    const byteCounts = (
      await Promise.all(
        newSegmentNames.map(async (name) => {
          try {
            const size = (await stat(join(outputDirectory, name))).size;
            session.seenSegments.add(name);
            return size;
          } catch {
            return null;
          }
        }),
      )
    ).filter(Number.isFinite);
    if (!byteCounts.length) return;
    if (session.lastSegmentSampleAt) {
      const elapsedMs = sampledAt - session.lastSegmentSampleAt;
      const totalBytes = byteCounts.reduce((total, value) => total + value, 0);
      if (elapsedMs > 0) session.metrics.bitrateMbps = (totalBytes * 8) / (elapsedMs * 1_000);
    }
    session.lastSegmentSampleAt = sampledAt;
  } catch {
    // 切片可能恰好被 HLS 清理，下一个采样周期会继续计算。
  } finally {
    session.bitrateSampleInFlight = false;
  }
}

function scheduleRestart(session, errorMessage) {
  if (!session.shouldRun || session.restartTimer) return;
  session.status = "reconnecting";
  session.lastError = errorMessage;
  session.streamingSince = null;
  const retryDelay = Math.min(10_000, 1_000 * 2 ** session.restartAttempt);
  session.restartAttempt += 1;
  session.restartTimer = setTimeout(() => {
    session.restartTimer = null;
    launchFfmpeg(session).catch((error) => scheduleRestart(session, error.message));
  }, retryDelay);
}

function stopStream(sourceId) {
  const session = streams.get(sourceId);
  if (!session) return;
  streams.delete(sourceId);
  session.sourceIds.delete(sourceId);
  if (session.sourceIds.size > 0) return;
  session.shouldRun = false;
  clearTimeout(session.restartTimer);
  clearInterval(session.healthTimer);
  session.process?.kill("SIGTERM");
  if (!session.process) cleanupSessionMedia(session);
}

function cleanupSessionMedia(session) {
  if (!session.outputDirectory) return;
  rm(session.outputDirectory, { recursive: true, force: true }).catch(() => {});
}

function getStreamStatuses() {
  return [...streams.entries()].map(([sourceId, session]) => serializeStream(sourceId, session));
}

function getStreamStatus(sourceId) {
  const session = streams.get(sourceId);
  return session ? serializeStream(sourceId, session) : null;
}

function serializeStream(sourceId, session) {
  return {
    sourceId,
    status: session.status,
    restartAttempt: session.restartAttempt,
    lastError: session.lastError,
    metrics: { ...session.metrics },
  };
}

function validateGatewayInput(value) {
  if (typeof value !== "string" || !value.trim()) throw httpError(400, "缺少媒体地址");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw httpError(400, "媒体地址格式错误");
  }
  if (!allowedProtocols.has(url.protocol)) {
    throw httpError(400, "媒体网关支持 HTTP、HTTPS、RTSP、RTMP 或 SRT 地址");
  }
  return url.toString();
}

async function serveMediaFile(pathname, response) {
  const relativePath = decodeURIComponent(pathname.slice("/media/".length));
  const filePath = resolve(mediaRoot, relativePath);
  if (!filePath.startsWith(`${resolve(mediaRoot)}${sep}`)) throw httpError(403, "禁止访问");
  const fileStats = await stat(filePath).catch(() => null);
  if (!fileStats?.isFile()) throw httpError(404, "媒体切片尚未生成");
  response.writeHead(200, {
    "Content-Type": extname(filePath) === ".m3u8" ? "application/vnd.apple.mpegurl" : "video/mp2t",
    "Content-Length": fileStats.size,
    "Cache-Control": "no-store, max-age=0",
  });
  createReadStream(filePath).pipe(response);
}

async function readSettings() {
  try {
    return JSON.parse(await readFile(settingsPath, "utf8"));
  } catch {
    return null;
  }
}

async function writeSettings(settings) {
  if (!settings || typeof settings !== "object") throw httpError(400, "设置内容无效");
  await mkdir(runtimeRoot, { recursive: true });
  const temporaryPath = `${settingsPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(settings, null, 2), "utf8");
  await rename(temporaryPath, settingsPath);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw httpError(413, "请求内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "JSON 格式错误");
  }
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function summarizeFfmpegError(stderr) {
  const message =
    stderr
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.includes("lavfi.astats") && !/^frame:\d/.test(line))
      .slice(-4)
      .join(" | ") || "FFmpeg 已退出";
  return message.replace(/(?:https?|rtsp|rtmp|srt):\/\/\S+/gi, "[media-url]");
}

function shutdown(signal) {
  for (const sourceId of streams.keys()) stopStream(sourceId);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
  console.log(`Media gateway stopping (${signal})`);
}
