using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace LiveMultiviewer
{
    internal static class NativeTests
    {
        [DllImport("user32.dll")]
        private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);

        internal static int Run(string projectRoot)
        {
            TestSettings();
            Obs.avdevice_register_all();
            string motion = "testsrc=size=320x180:rate=30[out0];sine=frequency=440:sample_rate=48000[out1]";
            string[] inputs = { motion, motion,
                "testsrc2=size=320x180:rate=30[out0];sine=frequency=880:sample_rate=48000[out1]",
                "color=black:size=320x180:rate=30[out0];sine=frequency=440:sample_rate=48000[out1]",
                "smptebars=size=320x180:rate=30[out0];sine=frequency=440:sample_rate=48000[out1]",
                "testsrc=size=320x180:rate=30[out0];anullsrc=r=48000:cl=stereo[out1]" };
            MonitorSettings settings = new MonitorSettings();
            for (int i = 0; i < 6; i++) settings.sources.Add(new SourceSettings { id = "source-" + i, name = "测试视频源 " + (i + 1), url = inputs[i] });
            using (MonitorWindow form = new MonitorWindow(null, settings, true))
            using (Timer poll = new Timer { Interval = 100 })
            {
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(-10000, -10000);
                form.ShowInTaskbar = false;
                SourceTile[] tiles = form.Tiles.ToArray();
                MediaSource shared = null;
                int result = 1, phase = 0, samples = 0;
                Stopwatch deadline = Stopwatch.StartNew();
                poll.Tick += delegate {
                    try
                    {
                        Require(deadline.Elapsed.TotalSeconds < 25, "Six-source test timed out.");
                        Require(tiles.All(t => !t.Video.RenderFailed && (t.Video.Source == null || !t.Video.Source.SampleFailed)), "Graphics callback failed.");
                        if (phase == 0 && tiles.All(t => t.Video.Source.Samples >= 2 && t.Video.Source.AudioMeasured))
                        {
                            Require(form.SessionCount == 5 && tiles[0].Video.Source == tiles[1].Video.Source, "Source sharing failed.");
                            MediaSource[] before = tiles.Select(t => t.Video.Source).ToArray();
                            Require(before.All(s => s.Width == 320 && s.Height == 180), "Decoded dimensions failed.");
                            form.FocusTile(tiles[0]); form.FocusTile(tiles[0]); form.MoveTile(tiles[0], tiles[2]);
                            Require(tiles.Select(t => t.Video.Source).SequenceEqual(before), "Layout recreated a source.");
                            form.SelectTile(tiles[0]);
                            Require(Obs.obs_source_get_monitoring_type(before[0].Handle) == 1, "Audio monitoring failed.");
                            form.SelectTile(tiles[0]);
                            Require(before.All(s => Obs.obs_source_get_monitoring_type(s.Handle) == 0), "Audio monitoring did not stop.");
                            MonitorSettings invalid = new MonitorSettings();
                            invalid.sources.Add(form.Tiles[0].Settings);
                            bool rolledBack = false;
                            try { form.ApplySettings(invalid); }
                            catch (ArgumentOutOfRangeException) { rolledBack = true; }
                            Require(rolledBack && form.SessionCount == 5 && tiles.Select(t => t.Video.Source).SequenceEqual(before), "Failed settings apply changed active sources.");
                            form.ApplySettings(new MonitorSettings { sources = form.Tiles.Select(t => t.Settings).ToList() });
                            Require(form.SessionCount == 5 && tiles.Select(t => t.Video.Source).SequenceEqual(before), "Unchanged settings restarted playback.");
                            Console.WriteLine("PASS: six previews, decode, D3D11 readback, audio, source sharing, focus/reorder");
                            Console.WriteLine("PASS: settings apply preserves sessions and rolls back provisional references on failure");
                            phase = 1;
                        }
                        else if (phase == 1 && tiles[3].Video.Source.Black && tiles[4].Video.Source.Frozen && tiles[5].Video.Source.Health(true).Text == "持续静音")
                        {
                            Require(!tiles[0].Video.Source.Black && !tiles[0].Video.Source.Frozen, "Moving source was marked frozen or black.");
                            SaveScreenshot(form, projectRoot);
                            Console.WriteLine("PASS: black/static/silent signals detected; moving source remains healthy");
                            MediaSource removed = tiles[4].Video.Source;
                            form.ReplaceSource(tiles[4], new SourceSettings { id = "source-4", name = "替换测试", url = inputs[2] });
                            Require(removed.Handle == IntPtr.Zero && form.SessionCount == 4, "Replaced source leaked.");
                            shared = tiles[0].Video.Source;
                            form.ReplaceSource(tiles[0], new SourceSettings { id = "source-0", name = "停用测试", url = "" });
                            Require(shared.Handle != IntPtr.Zero && tiles[1].Video.Source == shared, "Shared source stopped too early.");
                            samples = shared.Samples; phase = 2;
                        }
                        else if (phase == 2 && shared.Samples > samples)
                        {
                            form.ReplaceSource(tiles[1], new SourceSettings { id = "source-1", name = "停用测试 2", url = "" });
                            Require(shared.Handle == IntPtr.Zero && form.SessionCount == 3, "Last source reference leaked.");
                            Console.WriteLine("PASS: source replacement/removal preserves other previews");
                            result = 0; poll.Stop(); form.Close();
                        }
                    }
                    catch (Exception error)
                    {
                        Console.Error.WriteLine("FAIL: " + error.GetType().Name + (error is InvalidOperationException ? " " + error.Message : ""));
                        poll.Stop(); form.Close();
                    }
                };
                form.Shown += delegate { poll.Start(); };
                Application.Run(form);
                Require(form.SessionCount == 0, "Shutdown leaked sources.");
                if (result == 0) Console.WriteLine("PASS: clean shutdown");
                return result;
            }
        }

        private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }

        private static void SaveScreenshot(Form form, string root)
        {
            string directory = Path.Combine(root, ".runtime", "native");
            Directory.CreateDirectory(directory);
            using (Bitmap bitmap = new Bitmap(form.Width, form.Height))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                IntPtr dc = graphics.GetHdc();
                bool captured;
                try { captured = PrintWindow(form.Handle, dc, 2); }
                finally { graphics.ReleaseHdc(dc); }
                if (captured) bitmap.Save(Path.Combine(directory, "smoke.png"));
            }
        }

        private static void TestSettings()
        {
            string root = Path.Combine(Path.GetTempPath(), "LiveMultiviewer-test-" + Guid.NewGuid().ToString("N"));
            try
            {
                SettingsStore store = new SettingsStore(root);
                MonitorSettings settings = store.Load();
                settings.sources[0].url = "rtmp://example.invalid/test/synthetic-secret";
                settings.sources[0].name = "中文机位";
                store.Save(settings);
                Require(store.Load().sources[0].name == "中文机位", "Settings round trip failed.");
                Require(!System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(root, ".runtime", "native-settings.dat"))).Contains("synthetic-secret"), "Settings were written in plaintext.");
                settings.layoutLocked = false; store.Save(settings);
                Require(!store.Load().layoutLocked, "Atomic settings replacement failed.");
                Console.WriteLine("PASS: encrypted settings and atomic replacement");
            }
            finally
            {
                string parent = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (Path.GetFullPath(root).StartsWith(parent, StringComparison.OrdinalIgnoreCase) && Directory.Exists(root)) Directory.Delete(root, true);
            }
        }
    }
}
