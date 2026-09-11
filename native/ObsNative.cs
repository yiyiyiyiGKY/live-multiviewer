using System;
using System.Runtime.InteropServices;
using System.Text;

namespace LiveMultiviewer
{
    // ABI: OBS Studio 32.2.x, Windows x64. C bool is one byte, not Win32 BOOL.
    internal static class Obs
    {
        private const string Dll = "obs.dll";
        internal static byte[] Utf8(string value) { return value == null ? null : Encoding.UTF8.GetBytes(value + "\0"); }

        [StructLayout(LayoutKind.Sequential)]
        internal struct VideoInfo
        {
            internal IntPtr graphicsModule;
            internal uint fpsNum, fpsDen, baseWidth, baseHeight, outputWidth, outputHeight;
            internal int format;
            internal uint adapter;
            [MarshalAs(UnmanagedType.I1)] internal bool gpuConversion;
            internal int colorspace, range, scaleType;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct AudioInfo { internal uint samplesPerSec; internal int speakers; }
        [StructLayout(LayoutKind.Sequential)]
        internal struct DisplayInfo
        {
            internal IntPtr window;
            internal uint width, height, backbuffers;
            internal int format, depthFormat;
            internal uint adapter;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct Color4 { internal float r, g, b, a; }

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        internal delegate void DrawCallback(IntPtr data, uint width, uint height);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        internal delegate void LogCallback(int level, IntPtr format, IntPtr args, IntPtr data);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        internal delegate void MeterCallback(IntPtr data, IntPtr magnitude, IntPtr peak, IntPtr inputPeak);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetDllDirectory(string path);
        [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void base_set_log_handler(LogCallback callback, IntPtr data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_add_data_path(byte[] path);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)] internal static extern bool obs_startup(byte[] locale, byte[] configPath, IntPtr profiler);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_shutdown();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr obs_get_version_string();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern int obs_reset_video(ref VideoInfo info);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)] internal static extern bool obs_reset_audio(ref AudioInfo info);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern int obs_open_module(out IntPtr module, byte[] binary, byte[] data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)] internal static extern bool obs_init_module(IntPtr module);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_post_load_modules();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_enter_graphics();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_leave_graphics();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr obs_data_create();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_data_release(IntPtr data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_data_set_string(IntPtr data, byte[] key, byte[] value);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_data_set_int(IntPtr data, byte[] key, long value);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_data_set_bool(IntPtr data, byte[] key, [MarshalAs(UnmanagedType.I1)] bool value);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr obs_source_create_private(byte[] id, byte[] name, IntPtr settings);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_source_release(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_source_inc_active(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_source_dec_active(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_source_video_render(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern uint obs_source_get_width(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern uint obs_source_get_height(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern int obs_source_media_get_state(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern long obs_source_media_get_time(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_source_media_restart(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_source_set_audio_mixers(IntPtr source, uint mixers);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_source_set_monitoring_type(IntPtr source, int type);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern int obs_source_get_monitoring_type(IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)] internal static extern bool obs_set_audio_monitoring_device(byte[] name, byte[] id);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr obs_display_create(ref DisplayInfo info, uint background);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_display_destroy(IntPtr display);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_display_resize(IntPtr display, uint width, uint height);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_display_add_draw_callback(IntPtr display, DrawCallback callback, IntPtr data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_display_remove_draw_callback(IntPtr display, DrawCallback callback, IntPtr data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_ortho(float left, float right, float top, float bottom, float near, float far);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_set_viewport(int x, int y, int width, int height);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_projection_push();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_projection_pop();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_viewport_push();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_viewport_pop();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr gs_texrender_create(int format, int depthFormat);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_texrender_destroy(IntPtr render);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_texrender_reset(IntPtr render);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)] internal static extern bool gs_texrender_begin(IntPtr render, uint width, uint height);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_texrender_end(IntPtr render);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr gs_texrender_get_texture(IntPtr render);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr gs_stagesurface_create(uint width, uint height, int format);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_stagesurface_destroy(IntPtr surface);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_stage_texture(IntPtr surface, IntPtr texture);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)] internal static extern bool gs_stagesurface_map(IntPtr surface, out IntPtr data, out uint stride);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_stagesurface_unmap(IntPtr surface);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void gs_clear(uint flags, ref Color4 color, float depth, byte stencil);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr obs_volmeter_create(int type);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_volmeter_destroy(IntPtr meter);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)] internal static extern bool obs_volmeter_attach_source(IntPtr meter, IntPtr source);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_volmeter_add_callback(IntPtr meter, MeterCallback callback, IntPtr data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] internal static extern void obs_volmeter_remove_callback(IntPtr meter, MeterCallback callback, IntPtr data);
        [DllImport("avdevice-62.dll", CallingConvention = CallingConvention.Cdecl)] internal static extern void avdevice_register_all();
    }
}
