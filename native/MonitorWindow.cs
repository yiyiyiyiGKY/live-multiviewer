using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace LiveMultiviewer
{
    internal sealed class MonitorWindow : Form
    {
        private readonly SettingsStore store;
        private readonly SourcePool pool = new SourcePool();
        private MonitorSettings settings;
        internal readonly List<SourceTile> Tiles = new List<SourceTile>();
        private readonly Panel grid = new Panel { Dock = DockStyle.Fill, Padding = new Padding(6) };
        private readonly Label summary = new Label { Dock = DockStyle.Bottom, Height = 30, TextAlign = ContentAlignment.MiddleLeft };
        private readonly ListBox eventList = new ListBox { Dock = DockStyle.Right, Width = 370, Visible = false, HorizontalScrollbar = true };
        private readonly List<string> events;
        private readonly Timer healthTimer = new Timer { Interval = 250 };
        private readonly Button lockButton;
        private SourceTile focused, listened;
        private bool fullscreen, closing, synthetic;
        private Rectangle savedBounds;
        private FormWindowState savedWindowState;
        private bool eventSaveFailed;
        internal int SessionCount { get { return pool.Count; } }

        internal MonitorWindow(string projectRoot) : this(new SettingsStore(projectRoot), null, false) { }
        internal MonitorWindow(SettingsStore stateStore, MonitorSettings initial, bool useSynthetic)
        {
            store = stateStore;
            settings = initial ?? store.Load();
            settings.Normalize();
            synthetic = useSynthetic;
            events = store == null ? new List<string>() : store.LoadEvents();
            Text = "Live Multiviewer · 九路直播监看";
            ClientSize = new Size(1380, 840);
            MinimumSize = new Size(800, 520);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(6, 11, 20);
            ForeColor = Color.WhiteSmoke;
            Font = new Font("Microsoft YaHei UI", 10);
            KeyPreview = true;
            FlowLayoutPanel toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 54, Padding = new Padding(8), WrapContents = false };
            toolbar.Controls.Add(new Label { Text = "LIVE MULTIVIEWER", AutoSize = false, Width = 190, Height = 34, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.LightSkyBlue });
            toolbar.Controls.Add(Button("视频源设置", delegate { Configure(null); }));
            lockButton = Button("已锁定布局", ToggleLock);
            toolbar.Controls.Add(lockButton);
            toolbar.Controls.Add(Button("全部重连", ReconnectAll));
            toolbar.Controls.Add(Button("全屏", ToggleFullscreen));
            toolbar.Controls.Add(Button("状态记录", delegate { eventList.Visible = !eventList.Visible; }));
            toolbar.Controls.Add(Button("清空记录", delegate { events.Clear(); RenderEvents(); SaveEvents(); }));
            eventList.BackColor = BackColor;
            eventList.ForeColor = ForeColor;
            Controls.Add(grid);
            Controls.Add(eventList);
            Controls.Add(summary);
            Controls.Add(toolbar);
            foreach (SourceSettings source in settings.sources)
            {
                SourceTile tile = new SourceTile(source);
                tile.Selected += SelectTile;
                tile.FocusRequested += FocusTile;
                tile.ConfigureRequested += Configure;
                tile.AllowDrop = true;
                tile.DragEnter += delegate(object sender, DragEventArgs e) {
                    if (!settings.layoutLocked && e.Data.GetDataPresent(typeof(SourceTile))) e.Effect = DragDropEffects.Move;
                };
                tile.DragDrop += delegate(object sender, DragEventArgs e) {
                    SourceTile moved = e.Data.GetData(typeof(SourceTile)) as SourceTile;
                    if (!settings.layoutLocked && moved != null) MoveTile(moved, tile);
                };
                tile.Video.MouseMove += delegate(object sender, MouseEventArgs e) {
                    if (!settings.layoutLocked && e.Button == MouseButtons.Left) tile.DoDragDrop(tile, DragDropEffects.Move);
                };
                grid.Controls.Add(tile);
                Tiles.Add(tile);
            }
            grid.Resize += delegate { Arrange(); };
            KeyDown += delegate(object sender, KeyEventArgs e) {
                if (e.KeyCode == Keys.Escape) { if (focused != null) FocusTile(focused); else if (fullscreen) ToggleFullscreen(); eventList.Visible = false; }
                if (e.KeyCode == Keys.F11) ToggleFullscreen();
            };
            Shown += delegate {
                foreach (SourceTile tile in Tiles) ReplaceSource(tile, tile.Settings);
                Arrange();
                healthTimer.Start();
            };
            healthTimer.Tick += delegate { UpdateHealth(); };
            FormClosing += delegate { ShutdownSources(); };
            RenderEvents();
            UpdateLock();
        }

        private static Button Button(string text, Action action)
        {
            Button button = new Button { Text = text, AutoSize = true, Height = 34, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(16, 24, 40), ForeColor = Color.WhiteSmoke };
            button.Click += delegate { action(); };
            return button;
        }
        internal void ReplaceSource(SourceTile tile, SourceSettings next)
        {
            MediaSource previous = tile.Video.Source;
            MediaSource replacement = String.IsNullOrWhiteSpace(next.url) ? null :
                previous != null && previous.Input == next.url ? previous : pool.Acquire(next.url, synthetic);
            tile.Settings = next;
            if (!Object.ReferenceEquals(previous, replacement))
            {
                tile.Video.SetSource(replacement);
                pool.Release(previous);
                tile.Pending = tile.Committed = "在线";
                tile.PendingSince = MediaSource.Now;
            }
            ApplyListening();
        }
        internal void SelectTile(SourceTile tile)
        {
            listened = listened == tile || tile.Video.Source == null ? null : tile;
            ApplyListening();
        }
        private void ApplyListening()
        {
            MediaSource selected = listened == null ? null : listened.Video.Source;
            foreach (MediaSource source in Tiles.Select(t => t.Video.Source).Where(s => s != null).Distinct()) source.Listen(source == selected);
            foreach (SourceTile tile in Tiles) { tile.Listening = tile == listened && selected != null; tile.UpdateHealth(); }
        }
        internal void FocusTile(SourceTile tile) { focused = focused == tile ? null : tile; Arrange(); }
        internal void MoveTile(SourceTile source, SourceTile target)
        {
            if (source == target) return;
            int targetIndex = Tiles.IndexOf(target);
            Tiles.Remove(source);
            Tiles.Insert(targetIndex, source);
            settings.sources = Tiles.Select(t => t.Settings).ToList();
            SaveSettings();
            Arrange();
        }
        internal void Arrange()
        {
            if (Tiles.Count == 0) return;
            const int columns = 3;
            int rows = (Tiles.Count + columns - 1) / columns;
            int width = (grid.ClientSize.Width - 6) / columns, height = (grid.ClientSize.Height - 6) / rows;
            for (int i = 0; i < Tiles.Count; i++)
            {
                SourceTile tile = Tiles[i];
                tile.Visible = focused == null || focused == tile;
                tile.Bounds = focused == tile ? new Rectangle(6, 6, Math.Max(1, grid.Width - 12), Math.Max(1, grid.Height - 12)) :
                    new Rectangle(6 + i % columns * width, 6 + i / columns * height, Math.Max(1, width - 6), Math.Max(1, height - 6));
            }
        }
        private void ToggleLock() { settings.layoutLocked = !settings.layoutLocked; UpdateLock(); SaveSettings(); }
        private void UpdateLock() { lockButton.Text = settings.layoutLocked ? "已锁定布局" : "拖动调整布局"; }
        private void ReconnectAll() { foreach (MediaSource source in Tiles.Select(t => t.Video.Source).Where(s => s != null).Distinct()) source.Reconnect(); }
        private void ToggleFullscreen()
        {
            if (!fullscreen)
            {
                savedBounds = Bounds; savedWindowState = WindowState;
                WindowState = FormWindowState.Normal; FormBorderStyle = FormBorderStyle.None; Bounds = Screen.FromControl(this).Bounds;
            }
            else { FormBorderStyle = FormBorderStyle.Sizable; Bounds = savedBounds; WindowState = savedWindowState; }
            fullscreen = !fullscreen;
        }
        private void UpdateHealth()
        {
            if (closing) return;
            List<string> faults = new List<string>();
            foreach (SourceTile tile in Tiles)
            {
                SignalState health = tile.UpdateHealth();
                if (health.Severity > 0) faults.Add(tile.Settings.name + " " + health.Text);
                string current = tile.Video.Source == null || health.Text == "连接中" ? "在线" : health.Text;
                if (tile.Pending != current) { tile.Pending = current; tile.PendingSince = MediaSource.Now; }
                if (tile.Pending != tile.Committed && MediaSource.Now - tile.PendingSince >= 3)
                {
                    tile.Committed = tile.Pending;
                    events.Insert(0, DateTime.Now.ToString("MM-dd HH:mm:ss") + "  " + tile.Settings.name + "  " + current);
                    if (events.Count > 100) events.RemoveRange(100, events.Count - 100);
                    RenderEvents(); SaveEvents();
                }
            }
            summary.Text = "  " + DateTime.Now.ToString("HH:mm:ss") + "   " + (faults.Count > 0 ? String.Join(" · ", faults.ToArray()) : "暂无信号异常") + "   |   单击监听 · 双击聚焦 · Esc 返回" + (eventSaveFailed ? "   |   状态记录保存失败" : "");
        }
        private void RenderEvents() { eventList.Items.Clear(); eventList.Items.AddRange(events.Cast<object>().ToArray()); }
        private void SaveEvents()
        {
            try { if (store != null) store.SaveEvents(events); eventSaveFailed = false; }
            catch { eventSaveFailed = true; }
        }
        private void SaveSettings()
        {
            try { if (store != null) store.Save(settings); }
            catch { MessageBox.Show(this, "设置保存失败。当前画面继续运行，重启后将恢复上次保存的设置。", "保存失败", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }
        private void Configure(SourceTile selected)
        {
            using (Form dialog = new Form { Text = "视频源设置", Width = 980, Height = 720, StartPosition = FormStartPosition.CenterParent, BackColor = BackColor, ForeColor = ForeColor, Font = Font, MinimizeBox = false, MaximizeBox = false })
            {
                TableLayoutPanel fields = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = MonitorSettings.SourceCount + 1, Padding = new Padding(15), AutoScroll = true };
                fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
                fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 125));
                fields.Controls.Add(new Label { Text = "名称", AutoSize = true }, 0, 0);
                fields.Controls.Add(new Label { Text = "视频地址（HTTP / RTSP / RTMP / SRT），留空即停用", AutoSize = true }, 1, 0);
                TextBox[] names = new TextBox[MonitorSettings.SourceCount], urls = new TextBox[MonitorSettings.SourceCount];
                CheckBox[] audio = new CheckBox[MonitorSettings.SourceCount];
                for (int i = 0; i < MonitorSettings.SourceCount; i++)
                {
                    names[i] = new TextBox { Text = Tiles[i].Settings.name, Dock = DockStyle.Top, MaxLength = 30 };
                    urls[i] = new TextBox { Text = Tiles[i].Settings.url, Dock = DockStyle.Top };
                    audio[i] = new CheckBox { Text = "预期有声音", Checked = Tiles[i].Settings.audioExpected, AutoSize = true };
                    fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 65));
                    fields.Controls.Add(names[i], 0, i + 1); fields.Controls.Add(urls[i], 1, i + 1); fields.Controls.Add(audio[i], 2, i + 1);
                }
                Button save = Button("保存并应用", delegate {
                    MonitorSettings next = new MonitorSettings { layoutLocked = settings.layoutLocked };
                    for (int i = 0; i < MonitorSettings.SourceCount; i++) next.sources.Add(new SourceSettings { id = Tiles[i].Settings.id, name = names[i].Text.Trim(), url = urls[i].Text.Trim(), audioExpected = audio[i].Checked });
                    try { next.Validate(); }
                    catch (InvalidOperationException error) { MessageBox.Show(dialog, error.Message, "检查配置"); return; }
                    try { ApplySettings(next); }
                    catch { MessageBox.Show(dialog, "配置应用失败，已保留现有来源。请检查运行库和目录写入权限。", "应用失败"); return; }
                    dialog.DialogResult = DialogResult.OK;
                });
                save.Dock = DockStyle.Bottom; save.Height = 42;
                dialog.Controls.Add(fields); dialog.Controls.Add(save); dialog.AcceptButton = save;
                if (selected != null) dialog.Shown += delegate { urls[Tiles.IndexOf(selected)].Focus(); };
                dialog.ShowDialog(this);
            }
        }
        internal void ApplySettings(MonitorSettings next)
        {
            // Acquire every source before replacing anything. A failed create/save
            // releases the provisional references and leaves all previews intact.
            MediaSource[] replacements = new MediaSource[Tiles.Count];
            try
            {
                for (int i = 0; i < Tiles.Count; i++)
                    if (!String.IsNullOrWhiteSpace(next.sources[i].url)) replacements[i] = pool.Acquire(next.sources[i].url, synthetic);
                if (store != null) store.Save(next);
            }
            catch
            {
                foreach (MediaSource source in replacements) pool.Release(source);
                throw;
            }
            for (int i = 0; i < Tiles.Count; i++)
            {
                SourceTile tile = Tiles[i];
                MediaSource previous = tile.Video.Source;
                tile.Video.SetSource(replacements[i]);
                tile.Settings = next.sources[i];
                pool.Release(previous);
                if (previous != replacements[i])
                {
                    tile.Pending = tile.Committed = "在线";
                    tile.PendingSince = MediaSource.Now;
                }
            }
            settings = next;
            ApplyListening();
        }
        private void ShutdownSources()
        {
            if (closing) return;
            closing = true;
            healthTimer.Stop();
            foreach (SourceTile tile in Tiles) tile.Video.SetSource(null);
            pool.Dispose();
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { ShutdownSources(); healthTimer.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
