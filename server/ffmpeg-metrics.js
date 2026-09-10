export function createFfmpegMetrics(encoder) {
  return {
    videoCodec: "h264",
    audioCodec: "aac",
    encoder,
    fps: null,
    bitrateMbps: null,
    speed: null,
    audioRmsDb: null,
    audioLevel: 0,
    audioMeasured: false,
    videoFrozen: false,
    videoBlack: false,
    audioSilent: false,
  };
}

export function consumeProgress(buffer, metrics) {
  return consumeCompleteLines(buffer, (line) => {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) return;
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1).trim();
    if (key === "fps") metrics.fps = parseFiniteNumber(value);
    if (key === "bitrate") {
      const bitrateMbps = parseBitrateMbps(value);
      if (bitrateMbps !== null) metrics.bitrateMbps = bitrateMbps;
    }
    if (key === "speed") metrics.speed = parseFiniteNumber(value.replace(/x$/, ""));
  });
}

export function consumeDiagnostics(buffer, metrics) {
  return consumeCompleteLines(buffer, (line) => {
    const match = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?(?:\d+(?:\.\d+)?|inf))/i);
    if (match) {
      const rmsDb = Number(match[1]);
      metrics.audioMeasured = true;
      metrics.audioRmsDb = Number.isFinite(rmsDb) ? rmsDb : null;
      metrics.audioLevel = Number.isFinite(rmsDb) ? clamp((rmsDb + 60) / 60, 0, 1) : 0;
    }
    if (/freeze_start/i.test(line)) metrics.videoFrozen = true;
    if (/freeze_end/i.test(line)) metrics.videoFrozen = false;
    if (/black_start/i.test(line)) metrics.videoBlack = true;
    if (/black_end/i.test(line)) metrics.videoBlack = false;
    if (/silence_start/i.test(line)) metrics.audioSilent = true;
    if (/silence_end/i.test(line)) metrics.audioSilent = false;
  });
}

function consumeCompleteLines(buffer, consumeLine) {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) consumeLine(line);
  return remainder;
}

function parseFiniteNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function parseBitrateMbps(value) {
  if (!value || value === "N/A") return null;
  const number = parseFiniteNumber(value);
  if (number === null) return null;
  if (/mbits\/s/i.test(value)) return number;
  if (/kbits\/s/i.test(value)) return number / 1_000;
  if (/bits\/s/i.test(value)) return number / 1_000_000;
  return null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
