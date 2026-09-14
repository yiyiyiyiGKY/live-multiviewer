export const DEFAULT_SOURCE_COUNT = 9;

export const SOURCE_KIND = Object.freeze({
  UNCONFIGURED: "unconfigured",
  VIDEO_URL: "video-url",
});

const SOURCE_COLORS = ["#175CD3", "#7F56D9", "#039855", "#DC6803", "#C11574", "#0E7090"];

export function createDefaultSources(sourceCount = DEFAULT_SOURCE_COUNT) {
  return Array.from({ length: sourceCount }, (_, index) => ({
    id: `source-${index + 1}`,
    name: `视频源 ${index + 1}`,
    kind: SOURCE_KIND.UNCONFIGURED,
    url: "",
    audioExpected: true,
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
  }));
}

export function normalizeSources(input, sourceCount = DEFAULT_SOURCE_COUNT) {
  const defaults = createDefaultSources(sourceCount);
  const usedIds = new Set();

  return defaults.map((fallback, index) => {
    const candidate = input?.[index] ?? {};
    let id =
      typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : fallback.id;
    if (usedIds.has(id)) id = fallback.id;
    usedIds.add(id);

    return {
      id,
      name: normalizeSourceName(candidate.name, fallback.name),
      ...normalizeSourceAddress(candidate.url),
      audioExpected: candidate.audioExpected !== false,
      color: fallback.color,
    };
  });
}

export function moveSource(sources, sourceId, targetId) {
  const reorderedSources = [...sources];
  const sourceIndex = reorderedSources.findIndex((source) => source.id === sourceId);
  const targetIndex = reorderedSources.findIndex((source) => source.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return reorderedSources;

  const [movedSource] = reorderedSources.splice(sourceIndex, 1);
  reorderedSources.splice(targetIndex, 0, movedSource);
  return reorderedSources;
}

export function validateSources(sources, expectedCount = DEFAULT_SOURCE_COUNT) {
  if (!Array.isArray(sources) || sources.length !== expectedCount) {
    return [`必须配置 ${expectedCount} 路视频源`];
  }

  const errors = [];
  const normalizedNames = new Set();
  for (const source of sources) {
    const sourceName = source.name.trim();
    if (!sourceName) errors.push("每路视频源都需要名称");

    const nameKey = sourceName.toLocaleLowerCase("zh-CN");
    if (normalizedNames.has(nameKey)) errors.push(`名称重复：${source.name}`);
    normalizedNames.add(nameKey);

    if (source.url.trim() && !isSupportedMediaUrl(source.url)) {
      errors.push(`${source.name} 的地址必须使用 HTTP、HTTPS、RTSP、RTMP 或 SRT 协议`);
    }
  }
  return [...new Set(errors)];
}

export function isHttpMediaUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function isRealtimeMediaUrl(value) {
  try {
    return ["rtsp:", "rtmp:", "srt:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isSupportedMediaUrl(value) {
  return isHttpMediaUrl(value) || isRealtimeMediaUrl(value);
}

export function redactSourceUrl(value) {
  if (!value) return "未配置";
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    for (const key of ["token", "key", "passphrase", "password", "auth"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "***");
    }
    return url.toString();
  } catch {
    return value.replace(/(token|key|passphrase|password|auth)=([^&\s]+)/gi, "$1=***");
  }
}

function normalizeSourceAddress(value) {
  const url = typeof value === "string" ? value.trim() : "";
  return {
    kind: url ? SOURCE_KIND.VIDEO_URL : SOURCE_KIND.UNCONFIGURED,
    url,
  };
}

function normalizeSourceName(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalizedName = value.trim().replace(/\s+/g, " ").slice(0, 30);
  return normalizedName || fallback;
}
