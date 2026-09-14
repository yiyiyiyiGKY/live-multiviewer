import { spawn } from "node:child_process";
import { join } from "node:path";

export function createFfmpegArguments(inputUrl, outputDirectory, h264Encoder = "libx264") {
  const inputArguments = createInputArguments(inputUrl);
  const videoOutputArguments =
    h264Encoder === "h264_videotoolbox"
      ? ["-c:v", h264Encoder, "-b:v", "3M", "-maxrate", "4M", "-bufsize", "6M"]
      : [
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-tune",
          "zerolatency",
          "-crf",
          "22",
          "-pix_fmt",
          "yuv420p",
        ];

  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "info",
    "-fflags",
    "+genpts+discardcorrupt",
    ...inputArguments,
    "-i",
    inputUrl,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...videoOutputArguments,
    "-pix_fmt",
    "yuv420p",
    "-force_key_frames",
    "expr:gte(t,n_forced*1)",
    "-vf",
    "fps=30,scale=w='min(1280,iw)':h=-2:flags=fast_bilinear,freezedetect=n=-50dB:d=5,blackdetect=d=3:pix_th=0.10",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-af",
    "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=pipe\\\\:2,silencedetect=noise=-50dB:d=3",
    "-progress",
    "pipe:1",
    "-nostats",
    "-flush_packets",
    "1",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_list_size",
    "6",
    "-hls_delete_threshold",
    "2",
    "-start_number",
    String(Math.floor(Date.now() / 1_000)),
    "-hls_flags",
    "delete_segments+omit_endlist+independent_segments+program_date_time+temp_file",
    "-hls_segment_filename",
    join(outputDirectory, "segment-%010d.ts"),
    join(outputDirectory, "index.m3u8"),
  ];
}

export async function detectH264Encoder() {
  return new Promise((resolve) => {
    const probe = spawn("ffmpeg", ["-hide_banner", "-encoders"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    probe.stdout.setEncoding("utf8");
    probe.stdout.on("data", (chunk) => {
      output += chunk;
    });
    probe.once("error", () => {
      resolve("libx264");
    });
    probe.once("exit", () => {
      resolve(output.includes("h264_videotoolbox") ? "h264_videotoolbox" : "libx264");
    });
  });
}

function createInputArguments(inputUrl) {
  const commonArguments = ["-rw_timeout", "10000000"];
  const protocol = new URL(inputUrl).protocol;
  if (protocol === "rtsp:") {
    return ["-rtsp_transport", "tcp", "-timeout", "10000000", "-use_wallclock_as_timestamps", "1"];
  }
  if (protocol === "rtmp:") {
    return [...commonArguments, "-rtmp_live", "live", "-rtmp_buffer", "0", "-tcp_nodelay", "1"];
  }
  return commonArguments;
}
