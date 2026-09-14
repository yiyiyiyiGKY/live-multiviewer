using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace LiveMultiviewer
{
    internal sealed class SourcePool : IDisposable
    {
        private readonly Dictionary<string, MediaSource> sources = new Dictionary<string, MediaSource>(StringComparer.Ordinal);
        internal int Count { get { return sources.Count; } }
        internal MediaSource Acquire(string input, bool synthetic = false)
        {
            MediaSource source;
            if (!sources.TryGetValue(input, out source))
            {
                source = new MediaSource(input, synthetic);
                sources.Add(input, source);
            }
            source.Users++;
            return source;
        }
        internal void Release(MediaSource source)
        {
            if (source == null) return;
            if (--source.Users == 0) { sources.Remove(source.Input); source.Dispose(); }
        }
        public void Dispose()
        {
            foreach (MediaSource source in sources.Values) source.Dispose();
            sources.Clear();
        }
    }

    internal sealed class SignalState
    {
        internal readonly string Text;
        internal readonly int Severity;
        internal SignalState(string text, int severity) { Text = text; Severity = severity; }
    }

    internal sealed class MediaSource : IDisposable
    {
        internal readonly string Input;
        internal IntPtr Handle { get; private set; }
        internal int Users;
        internal volatile float AudioDb = float.NegativeInfinity;
        internal volatile bool Black, Frozen;
        internal volatile int Samples;
        internal volatile bool SampleFailed;
        private long audioAt;
        private readonly long createdAt = Stopwatch.GetTimestamp();
        private readonly Obs.MeterCallback meterCallback;
        private readonly float[] levels = new float[2];
        private IntPtr meter, texture, surface;
        private readonly byte[] pixels = new byte[64 * 36 * 4];
        private readonly byte[] previous = new byte[64 * 36 * 4];
        private double sampledAt, blackSince, frozenSince, silentSince;

        internal static double Now { get { return (double)Stopwatch.GetTimestamp() / Stopwatch.Frequency; } }
        internal double Age { get { return (double)(Stopwatch.GetTimestamp() - createdAt) / Stopwatch.Frequency; } }
        internal int State { get { return Obs.obs_source_media_get_state(Handle); } }
        internal bool AudioMeasured { get { return Interlocked.Read(ref audioAt) != 0; } }
        internal uint Width { get { return Obs.obs_source_get_width(Handle); } }
        internal uint Height { get { return Obs.obs_source_get_height(Handle); } }

        internal MediaSource(string input, bool synthetic)
        {
            Input = input;
            IntPtr settings = Obs.obs_data_create();
            try
            {
                Obs.obs_data_set_bool(settings, Obs.Utf8("is_local_file"), false);
                Obs.obs_data_set_string(settings, Obs.Utf8("input"), Obs.Utf8(input));
                if (synthetic) Obs.obs_data_set_string(settings, Obs.Utf8("input_format"), Obs.Utf8("lavfi"));
                Obs.obs_data_set_bool(settings, Obs.Utf8("log_changes"), false);
                Obs.obs_data_set_bool(settings, Obs.Utf8("hw_decode"), true);
                Obs.obs_data_set_bool(settings, Obs.Utf8("restart_on_activate"), false);
                Obs.obs_data_set_bool(settings, Obs.Utf8("close_when_inactive"), false);
                Obs.obs_data_set_bool(settings, Obs.Utf8("clear_on_media_end"), true);
                // Live monitoring prioritizes current frames over smooth playback.
                // OBS 32.2.1 enables AVFMT_FLAG_NOBUFFER when this value is zero.
                Obs.obs_data_set_int(settings, Obs.Utf8("buffering_mb"), 0);
                Obs.obs_data_set_int(settings, Obs.Utf8("reconnect_delay_sec"), 2);
                Handle = Obs.obs_source_create_private(Obs.Utf8("ffmpeg_source"), Obs.Utf8("monitor-media"), settings);
            }
            finally { Obs.obs_data_release(settings); }
            if (Handle == IntPtr.Zero) throw new InvalidOperationException("无法创建 OBS 媒体源。");
            Obs.obs_source_set_audio_mixers(Handle, 0);
            Obs.obs_source_inc_active(Handle);
            meterCallback = OnMeter;
            meter = Obs.obs_volmeter_create(2);
            if (meter != IntPtr.Zero)
            {
                Obs.obs_volmeter_add_callback(meter, meterCallback, IntPtr.Zero);
                Obs.obs_volmeter_attach_source(meter, Handle);
            }
        }

        private void OnMeter(IntPtr data, IntPtr magnitude, IntPtr peak, IntPtr inputPeak)
        {
            Marshal.Copy(magnitude, levels, 0, levels.Length);
            AudioDb = Math.Max(levels[0], levels[1]);
            Interlocked.Exchange(ref audioAt, Stopwatch.GetTimestamp());
        }

        internal void Listen(bool enabled) { Obs.obs_source_set_monitoring_type(Handle, enabled ? 1 : 0); }
        internal void Reconnect() { Obs.obs_source_media_restart(Handle); }

        // Runs on the OBS graphics thread, at most once per source per second.
        // Only a 64x36 image is read back, never the full-resolution preview.
        internal void Sample()
        {
            double now = Now;
            if (now - sampledAt < 1 || Width == 0 || Height == 0) return;
            bool continuous = sampledAt > 0 && now - sampledAt < 2.5;
            sampledAt = now;
            if (texture == IntPtr.Zero) texture = Obs.gs_texrender_create(5, 0);
            if (surface == IntPtr.Zero) surface = Obs.gs_stagesurface_create(64, 36, 5);
            if (texture == IntPtr.Zero || surface == IntPtr.Zero) { SampleFailed = true; return; }
            Obs.gs_texrender_reset(texture);
            if (!Obs.gs_texrender_begin(texture, 64, 36)) { SampleFailed = true; return; }
            try
            {
                Obs.Color4 clear = new Obs.Color4 { a = 1 };
                Obs.gs_clear(1, ref clear, 1, 0);
                Obs.gs_ortho(0, Width, 0, Height, -100, 100);
                Obs.obs_source_video_render(Handle);
            }
            finally { Obs.gs_texrender_end(texture); }
            Obs.gs_stage_texture(surface, Obs.gs_texrender_get_texture(texture));
            IntPtr mapped;
            uint stride;
            if (!Obs.gs_stagesurface_map(surface, out mapped, out stride)) { SampleFailed = true; return; }
            try
            {
                for (int row = 0; row < 36; row++)
                    Marshal.Copy(IntPtr.Add(mapped, checked(row * (int)stride)), pixels, row * 256, 256);
            }
            finally { Obs.gs_stagesurface_unmap(surface); }
            double difference = 0;
            int dark = 0;
            for (int i = 0; i < pixels.Length; i += 4)
            {
                if ((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 < 16) dark++;
                for (int channel = 0; channel < 3; channel++) difference += Math.Abs(pixels[i + channel] - previous[i + channel]);
            }
            Buffer.BlockCopy(pixels, 0, previous, 0, pixels.Length);
            if (!continuous || dark < 64 * 36 * 0.98) blackSince = now;
            if (!continuous || difference / (64 * 36 * 3) >= 0.5) frozenSince = now;
            Black = now - blackSince >= 3;
            Frozen = now - frozenSince >= 5;
            SampleFailed = false;
            Samples++;
        }

        internal SignalState Health(bool audioExpected)
        {
            int state = State;
            if (state == 7 || state == 5 || state == 6) return new SignalState("信号断开，等待重新连接", 2);
            if (Width == 0 || state != 1) return new SignalState(Age < 15 ? "连接中" : "未收到可播放画面", Age < 15 ? 0 : 2);
            if (SampleFailed) return new SignalState("画面检测不可用", 1);
            if (Black) return new SignalState("持续黑场", 1);
            if (Frozen) return new SignalState("画面持续静止", 1);
            double lastAudio = (double)Interlocked.Read(ref audioAt) / Stopwatch.Frequency;
            if (audioExpected && Age >= 10 && Now - lastAudio > 5) return new SignalState("未检测到音频", 1);
            if (AudioDb >= -50) silentSince = Now;
            if (audioExpected && Age >= 5 && Now - silentSince >= 3) return new SignalState("持续静音", 1);
            return new SignalState("在线", 0);
        }

        public void Dispose()
        {
            if (Handle == IntPtr.Zero) return;
            if (meter != IntPtr.Zero)
            {
                Obs.obs_volmeter_remove_callback(meter, meterCallback, IntPtr.Zero);
                Obs.obs_volmeter_destroy(meter);
                meter = IntPtr.Zero;
            }
            Obs.obs_enter_graphics();
            try
            {
                if (surface != IntPtr.Zero) Obs.gs_stagesurface_destroy(surface);
                if (texture != IntPtr.Zero) Obs.gs_texrender_destroy(texture);
                surface = texture = IntPtr.Zero;
            }
            finally { Obs.obs_leave_graphics(); }
            Obs.obs_source_set_monitoring_type(Handle, 0);
            Obs.obs_source_dec_active(Handle);
            Obs.obs_source_release(Handle);
            Handle = IntPtr.Zero;
            GC.KeepAlive(meterCallback);
        }
    }
}
