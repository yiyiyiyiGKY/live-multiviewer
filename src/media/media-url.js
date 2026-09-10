export const PLAYBACK_ENGINE = Object.freeze({
  HLS: "hls",
  HTTP_FLV: "http-flv",
  HTTP_MPEG_TS: "http-mpegts",
  NATIVE_VIDEO: "native-video",
});

export function classifyMediaUrl(value) {
  const url = new URL(value);
  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith(".m3u8")) return PLAYBACK_ENGINE.HLS;
  if (pathname.endsWith(".flv")) return PLAYBACK_ENGINE.HTTP_FLV;
  if (pathname.endsWith(".ts")) return PLAYBACK_ENGINE.HTTP_MPEG_TS;
  return PLAYBACK_ENGINE.NATIVE_VIDEO;
}

export function describePlaybackProtocol(value) {
  try {
    const engine = classifyMediaUrl(value);
    if (engine === PLAYBACK_ENGINE.HLS) return "HLS";
    if (engine === PLAYBACK_ENGINE.HTTP_FLV) return "HTTP-FLV";
    if (engine === PLAYBACK_ENGINE.HTTP_MPEG_TS) return "HTTP-TS";
    return new URL(value).protocol.replace(":", "").toUpperCase();
  } catch {
    return "URL";
  }
}
