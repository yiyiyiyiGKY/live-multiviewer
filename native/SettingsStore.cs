using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace LiveMultiviewer
{
    public sealed class SourceSettings
    {
        public string id { get; set; }
        public string name { get; set; }
        public string url { get; set; }
        public bool audioExpected { get; set; }
        public SourceSettings() { audioExpected = true; }
    }
    public sealed class MonitorSettings
    {
        internal const int SourceCount = 9;
        public List<SourceSettings> sources { get; set; }
        public bool layoutLocked { get; set; }
        public MonitorSettings() { layoutLocked = true; sources = new List<SourceSettings>(); }
        internal void Normalize()
        {
            if (sources == null) sources = new List<SourceSettings>();
            if (sources.Count > SourceCount) sources.RemoveRange(SourceCount, sources.Count - SourceCount);
            while (sources.Count < SourceCount) sources.Add(new SourceSettings());
            HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < sources.Count; i++)
            {
                SourceSettings source = sources[i] ?? new SourceSettings();
                sources[i] = source;
                if (String.IsNullOrWhiteSpace(source.id) || !ids.Add(source.id))
                {
                    source.id = "source-" + (i + 1);
                    while (!ids.Add(source.id)) source.id += "-new";
                }
                source.name = String.IsNullOrWhiteSpace(source.name) ? "视频源 " + (i + 1) : source.name.Trim();
                if (source.name.Length > 30) source.name = source.name.Substring(0, 30);
                source.url = (source.url ?? "").Trim();
            }
        }
        internal void Validate()
        {
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (SourceSettings source in sources)
            {
                if (String.IsNullOrWhiteSpace(source.name) || !names.Add(source.name.Trim()))
                    throw new InvalidOperationException("来源名称不能为空或重复。");
                if (String.IsNullOrWhiteSpace(source.url)) continue;
                Uri uri;
                if (!Uri.TryCreate(source.url.Trim(), UriKind.Absolute, out uri) ||
                    Array.IndexOf(new[] { "http", "https", "rtsp", "rtmp", "srt" }, uri.Scheme) < 0)
                    throw new InvalidOperationException("视频地址必须使用 HTTP、HTTPS、RTSP、RTMP 或 SRT 协议。");
            }
        }
    }
    internal sealed class SettingsStore
    {
        private readonly string directory;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        internal SettingsStore(string projectRoot) { directory = Path.Combine(projectRoot, ".runtime"); }
        internal MonitorSettings Load()
        {
            MonitorSettings result;
            string protectedPath = Path.Combine(directory, "native-settings.dat");
            string legacyPath = Path.Combine(directory, "settings.json");
            if (File.Exists(protectedPath)) result = json.Deserialize<MonitorSettings>(ReadProtected(protectedPath));
            else if (File.Exists(legacyPath)) result = json.Deserialize<MonitorSettings>(File.ReadAllText(legacyPath, Encoding.UTF8));
            else result = new MonitorSettings();
            if (result == null) throw new InvalidOperationException("监看配置无效。");
            result.Normalize();
            result.Validate();
            return result;
        }
        internal void Save(MonitorSettings settings) { WriteProtected("native-settings.dat", json.Serialize(settings)); }
        internal List<string> LoadEvents()
        {
            string path = Path.Combine(directory, "native-events.dat");
            List<string> events = File.Exists(path) ? json.Deserialize<List<string>>(ReadProtected(path)) : new List<string>();
            if (events == null) events = new List<string>();
            if (events.Count > 100) events.RemoveRange(100, events.Count - 100);
            return events;
        }
        internal void SaveEvents(List<string> events) { WriteProtected("native-events.dat", json.Serialize(events)); }
        private static string ReadProtected(string path)
        {
            byte[] clear = ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser);
            try { return Encoding.UTF8.GetString(clear); }
            finally { Array.Clear(clear, 0, clear.Length); }
        }
        private void WriteProtected(string name, string value)
        {
            Directory.CreateDirectory(directory);
            byte[] clear = Encoding.UTF8.GetBytes(value);
            byte[] encrypted;
            try { encrypted = ProtectedData.Protect(clear, null, DataProtectionScope.CurrentUser); }
            finally { Array.Clear(clear, 0, clear.Length); }
            string destination = Path.Combine(directory, name);
            string temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllBytes(temporary, encrypted);
                if (File.Exists(destination)) File.Replace(temporary, destination, null);
                else File.Move(temporary, destination);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
}
