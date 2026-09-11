using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace LiveMultiviewer
{
    internal static class Program
    {
        // OBS's default logger may include signed media URLs. Never install a file logger.
        private static readonly Obs.LogCallback QuietLog = delegate { };

        [STAThread]
        private static int Main(string[] args)
        {
            bool started = false;
            Mutex instance = null;
            try
            {
                string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
                string root = Argument(args, "--obs-root", Path.Combine(baseDirectory, "runtime", "obs"));
                string project = Argument(args, "--project-root", baseDirectory);
                if (!File.Exists(Path.Combine(root, "bin", "64bit", "obs.dll")))
                    throw new InvalidOperationException("缺少运行库。请先完整解压压缩包，再启动程序。");
                if (Array.IndexOf(args, "--self-test") < 0)
                {
                    bool first;
                    string identity;
                    using (SHA256 hash = SHA256.Create()) identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(project.ToUpperInvariant()))).Replace("-", "");
                    instance = new Mutex(true, "Local\\LiveMultiviewer-" + identity, out first);
                    if (!first) throw new InvalidOperationException("此项目的监看窗口已经运行，请使用现有窗口。");
                }
                string bin = Path.Combine(root, "bin", "64bit");
                if (!Obs.SetDllDirectory(bin)) throw new InvalidOperationException("无法加载 OBS 运行库目录。");
                Directory.SetCurrentDirectory(bin);
                Obs.base_set_log_handler(QuietLog, IntPtr.Zero);
                string version = Marshal.PtrToStringAnsi(Obs.obs_get_version_string());
                if (!version.StartsWith("32.2.", StringComparison.Ordinal))
                    throw new InvalidOperationException("当前原生接口已验证 OBS 32.2.x；检测到 " + version);
                Obs.obs_add_data_path(Obs.Utf8(Path.Combine(root, "data", "libobs")));
                started = Obs.obs_startup(Obs.Utf8("zh-CN"), null, IntPtr.Zero);
                if (!started) throw new InvalidOperationException("OBS 内核初始化失败。");
                IntPtr graphics = Marshal.StringToHGlobalAnsi("libobs-d3d11.dll");
                try
                {
                    Obs.VideoInfo video = new Obs.VideoInfo {
                        graphicsModule = graphics, fpsNum = 60, fpsDen = 1,
                        baseWidth = 1920, baseHeight = 1080, outputWidth = 1920, outputHeight = 1080,
                        format = 2, gpuConversion = true, colorspace = 2, range = 1, scaleType = 3
                    };
                    int result = Obs.obs_reset_video(ref video);
                    if (result != 0) throw new InvalidOperationException("D3D11 视频初始化失败，代码 " + result);
                }
                finally { Marshal.FreeHGlobal(graphics); }
                Obs.AudioInfo audio = new Obs.AudioInfo { samplesPerSec = 48000, speakers = 2 };
                if (!Obs.obs_reset_audio(ref audio)) throw new InvalidOperationException("音频初始化失败。");
                IntPtr module;
                int moduleResult = Obs.obs_open_module(out module,
                    Obs.Utf8(Path.Combine(root, "obs-plugins", "64bit", "obs-ffmpeg.dll")),
                    Obs.Utf8(Path.Combine(root, "data", "obs-plugins", "obs-ffmpeg")));
                if (moduleResult != 0 || !Obs.obs_init_module(module))
                    throw new InvalidOperationException("OBS 媒体源模块加载失败。");
                Obs.obs_post_load_modules();
                Obs.obs_set_audio_monitoring_device(Obs.Utf8("Default"), Obs.Utf8("default"));
                Obs.SetProcessDPIAware();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
                Console.WriteLine("Live Multiviewer / libobs " + version);
                if (Array.IndexOf(args, "--self-test") >= 0)
                    return NativeTests.Run(project);
                using (MonitorWindow window = new MonitorWindow(project))
                {
                    ConsoleCancelEventHandler cancel = delegate(object sender, ConsoleCancelEventArgs e) {
                        e.Cancel = true;
                        if (window.IsHandleCreated && !window.IsDisposed) window.BeginInvoke(new Action(window.Close));
                    };
                    Console.CancelKeyPress += cancel;
                    try { Application.Run(window); }
                    finally { Console.CancelKeyPress -= cancel; }
                }
                return 0;
            }
            catch (Exception error)
            {
                // Do not print exception data originating in source settings or media URLs.
                Console.Error.WriteLine("监看启动失败：" + error.GetType().Name);
                if (error is InvalidOperationException || error is ArgumentException)
                    Console.Error.WriteLine(error.Message);
                if (Array.IndexOf(args, "--self-test") < 0)
                    MessageBox.Show("启动失败：" + error.GetType().Name + "。\n请完整解压文件，确认电脑使用 Windows 10/11 64 位，并已安装 Microsoft Visual C++ 2015–2022 x64 运行库。\n" +
                        (error is InvalidOperationException ? error.Message : "详细操作见使用说明。"), "Live Multiviewer", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally
            {
                if (started) Obs.obs_shutdown();
                if (instance != null) instance.Dispose();
                GC.KeepAlive(QuietLog);
            }
        }

        private static string Argument(string[] args, string key, string fallback)
        {
            int index = Array.IndexOf(args, key);
            if (index < 0) return Path.GetFullPath(fallback);
            if (index + 1 >= args.Length) throw new ArgumentException("缺少启动参数 " + key);
            return Path.GetFullPath(args[index + 1]);
        }
    }
}
