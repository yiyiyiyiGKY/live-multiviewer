import { PLAYBACK_ENGINE, classifyMediaUrl } from "../media-url.js";

export const HLS_PLAYBACK_CONFIG = Object.freeze({
  lowLatencyMode: true,
  backBufferLength: 6,
  maxBufferLength: 4,
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 5,
  liveSyncOnStallIncrease: 0,
  maxLiveSyncPlaybackRate: 1.1,
});

export async function createPlaybackAdapter({ url, video, onFatalError, onWarning }) {
  const engine = classifyMediaUrl(url);
  if (engine === PLAYBACK_ENGINE.HLS) {
    const { default: Hls } = await import("hls.js/light");
    return createHlsAdapter({ Hls, url, video, onFatalError, onWarning });
  }
  if (engine === PLAYBACK_ENGINE.HTTP_FLV || engine === PLAYBACK_ENGINE.HTTP_MPEG_TS) {
    const { default: mpegts } = await import("mpegts.js");
    return createMpegTsAdapter({ mpegts, engine, url, video, onFatalError });
  }
  return createNativeVideoAdapter({ url, video });
}

function createHlsAdapter({ Hls, url, video, onFatalError, onWarning }) {
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    return createNativeVideoAdapter({ url, video });
  }
  if (!Hls.isSupported()) throw new Error("当前浏览器不支持 HLS 播放");

  const hls = new Hls(HLS_PLAYBACK_CONFIG);

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      onWarning(`HLS ${data.details}`);
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      onWarning("HLS 媒体错误，正在恢复解码器");
      hls.recoverMediaError();
      return;
    }
    onFatalError(`HLS ${data.details}`);
  });

  return {
    engine: PLAYBACK_ENGINE.HLS,
    start() {
      hls.attachMedia(video);
      hls.once(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
    },
    getBitrateMbps() {
      const bitsPerSecond = hls.bandwidthEstimate;
      return Number.isFinite(bitsPerSecond) ? bitsPerSecond / 1_000_000 : null;
    },
    destroy() {
      hls.destroy();
    },
  };
}

function createMpegTsAdapter({ mpegts, engine, url, video, onFatalError }) {
  if (!mpegts.getFeatureList().mseLivePlayback) {
    throw new Error("当前浏览器不支持 HTTP-FLV/TS 播放");
  }

  const mediaType = engine === PLAYBACK_ENGINE.HTTP_FLV ? "flv" : "mpegts";
  const player = mpegts.createPlayer(
    {
      type: mediaType,
      isLive: true,
      cors: true,
      url,
    },
    {
      enableWorker: false,
      enableStashBuffer: false,
      lazyLoad: false,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 1.5,
      liveBufferLatencyMinRemain: 0.3,
    },
  );
  let bitrateMbps = null;

  player.on(mpegts.Events.ERROR, (_errorType, errorDetail) => {
    onFatalError(`HTTP 流 ${errorDetail}`);
  });
  player.on(mpegts.Events.STATISTICS_INFO, (statistics) => {
    if (Number.isFinite(statistics.speed)) bitrateMbps = (statistics.speed * 8) / 1_000;
  });

  return {
    engine,
    start() {
      player.attachMediaElement(video);
      player.load();
      player.play().catch(() => {});
    },
    getBitrateMbps() {
      return bitrateMbps;
    },
    destroy() {
      player.pause();
      player.unload();
      player.detachMediaElement();
      player.destroy();
    },
  };
}

function createNativeVideoAdapter({ url, video }) {
  return {
    engine: PLAYBACK_ENGINE.NATIVE_VIDEO,
    start() {
      video.src = url;
      video.load();
      video.play().catch(() => {});
    },
    getBitrateMbps() {
      return null;
    },
    destroy() {
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}
