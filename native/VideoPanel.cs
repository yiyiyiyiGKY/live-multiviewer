using System;
using System.Drawing;
using System.Windows.Forms;

namespace LiveMultiviewer
{
    internal sealed class VideoPanel : Panel
    {
        private readonly Obs.DrawCallback draw;
        private IntPtr display;
        private MediaSource source;
        internal volatile bool RenderFailed;
        internal MediaSource Source { get { return source; } }

        internal VideoPanel()
        {
            BackColor = Color.Black;
            SetStyle(ControlStyles.Opaque | ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint, true);
            draw = Render;
        }

        internal void SetSource(MediaSource next)
        {
            // Same lock order as the graphics callback. Never hold a managed lock
            // while waiting for OBS's graphics/display locks.
            Obs.obs_enter_graphics();
            try { source = next; RenderFailed = false; }
            finally { Obs.obs_leave_graphics(); }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Obs.DisplayInfo info = new Obs.DisplayInfo {
                window = Handle, width = (uint)Math.Max(1, ClientSize.Width), height = (uint)Math.Max(1, ClientSize.Height),
                backbuffers = 2, format = 5, depthFormat = 0
            };
            display = Obs.obs_display_create(ref info, 0xFF000000);
            if (display == IntPtr.Zero) throw new InvalidOperationException("无法创建原生视频显示区域。");
            Obs.obs_display_add_draw_callback(display, draw, IntPtr.Zero);
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            if (display != IntPtr.Zero)
            {
                Obs.obs_display_remove_draw_callback(display, draw, IntPtr.Zero);
                Obs.obs_display_destroy(display);
                display = IntPtr.Zero;
            }
            base.OnHandleDestroyed(e);
            GC.KeepAlive(draw);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (display != IntPtr.Zero) Obs.obs_display_resize(display, (uint)Math.Max(1, Width), (uint)Math.Max(1, Height));
        }
        protected override void OnPaint(PaintEventArgs e) { if (display == IntPtr.Zero) e.Graphics.Clear(Color.Black); }
        protected override void OnPaintBackground(PaintEventArgs e) { }

        private void Render(IntPtr data, uint width, uint height)
        {
            MediaSource current = source;
            if (current == null) return;
            try
            {
                uint sourceWidth = current.Width, sourceHeight = current.Height;
                if (sourceWidth == 0 || sourceHeight == 0) return;
                Obs.gs_projection_push();
                Obs.gs_viewport_push();
                try
                {
                    current.Sample();
                    float scale = Math.Min((float)width / sourceWidth, (float)height / sourceHeight);
                    int fittedWidth = Math.Max(1, (int)(sourceWidth * scale));
                    int fittedHeight = Math.Max(1, (int)(sourceHeight * scale));
                    Obs.gs_set_viewport(((int)width - fittedWidth) / 2, ((int)height - fittedHeight) / 2, fittedWidth, fittedHeight);
                    Obs.gs_ortho(0, sourceWidth, 0, sourceHeight, -100, 100);
                    Obs.obs_source_video_render(current.Handle);
                }
                finally { Obs.gs_viewport_pop(); Obs.gs_projection_pop(); }
            }
            catch { RenderFailed = true; } // Managed exceptions must not cross a native callback boundary.
        }
    }
}
