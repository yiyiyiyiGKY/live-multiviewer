using System;
using System.Drawing;
using System.Windows.Forms;

namespace LiveMultiviewer
{
    internal sealed class SourceTile : Panel
    {
        internal SourceSettings Settings;
        internal readonly VideoPanel Video = new VideoPanel { Dock = DockStyle.Fill, TabStop = true };
        private readonly Label title = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
        private readonly Label status = new Label { Dock = DockStyle.Top, Height = 23, TextAlign = ContentAlignment.MiddleLeft };
        private readonly Label empty = new Label { Dock = DockStyle.Fill, Text = "未配置视频地址", TextAlign = ContentAlignment.MiddleCenter, BackColor = Color.FromArgb(7, 11, 18) };
        private readonly Panel meter = new Panel { Dock = DockStyle.Bottom, Height = 5, BackColor = Color.FromArgb(52, 64, 84) };
        private readonly Panel fill = new Panel { Dock = DockStyle.Left, BackColor = Color.FromArgb(18, 183, 106) };
        private readonly Timer click = new Timer { Interval = SystemInformation.DoubleClickTime };
        internal event Action<SourceTile> Selected, FocusRequested, ConfigureRequested;
        internal bool Listening;
        internal string Pending = "在线", Committed = "在线";
        internal double PendingSince;

        internal SourceTile(SourceSettings settings)
        {
            Settings = settings;
            BackColor = Color.FromArgb(16, 24, 40);
            ForeColor = Color.WhiteSmoke;
            Padding = new Padding(2);
            Panel header = new Panel { Dock = DockStyle.Top, Height = 34, Padding = new Padding(8, 0, 2, 0) };
            Button configure = new Button { Dock = DockStyle.Right, Text = "设置", Width = 54, FlatStyle = FlatStyle.Flat };
            configure.Click += delegate { if (ConfigureRequested != null) ConfigureRequested(this); };
            header.Controls.Add(title);
            header.Controls.Add(configure);
            Panel footer = new Panel { Dock = DockStyle.Bottom, Height = 36, Padding = new Padding(8, 0, 8, 5) };
            meter.Controls.Add(fill);
            footer.Controls.Add(status);
            footer.Controls.Add(meter);
            Video.Controls.Add(empty);
            Controls.Add(Video);
            Controls.Add(footer);
            Controls.Add(header);
            click.Tick += delegate { click.Stop(); if (Selected != null) Selected(this); };
            foreach (Control control in new Control[] { Video, empty, title })
            {
                control.Click += delegate { click.Stop(); click.Start(); };
                control.DoubleClick += delegate { click.Stop(); if (FocusRequested != null) FocusRequested(this); };
            }
            Video.KeyDown += delegate(object sender, KeyEventArgs e) {
                if (e.KeyCode == Keys.Space) { e.SuppressKeyPress = true; if (Selected != null) Selected(this); }
                if (e.KeyCode == Keys.Enter && FocusRequested != null) FocusRequested(this);
            };
            UpdateHealth();
        }

        internal SignalState UpdateHealth()
        {
            MediaSource source = Video.Source;
            SignalState health = source == null ? new SignalState("未配置", 0) : source.Health(Settings.audioExpected);
            if (Video.RenderFailed) health = new SignalState("画面显示失败，请重新连接", 2);
            title.Text = Settings.name + (Listening ? "  ·  监听" : "");
            status.Text = health.Text + (source != null && source.Width > 0 ? "   " + source.Width + "×" + source.Height : "");
            status.ForeColor = health.Severity == 2 ? Color.Salmon : health.Severity == 1 ? Color.Gold : Color.FromArgb(152, 210, 180);
            empty.Visible = source == null || source.Width == 0;
            empty.Text = source == null ? "未配置视频地址 · 点击设置" : health.Text;
            double level = source == null || Single.IsNaN(source.AudioDb) ? 0 : Math.Max(0, Math.Min(1, (source.AudioDb + 60) / 60));
            fill.Width = (int)(meter.ClientSize.Width * level);
            BackColor = Listening ? Color.FromArgb(23, 92, 150) : Color.FromArgb(16, 24, 40);
            return health;
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) click.Dispose();
            base.Dispose(disposing);
        }
    }
}
