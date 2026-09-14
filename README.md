# Live Multiviewer

通用的导播九路视频监看软件。Windows 原生版直接使用 OBS 媒体源解码和 D3D11 绘制，跳过原网页方案的本机转码与 HLS 分片；旧网页版本仍可单独运行。

## Windows 原生版与转发包

源码运行：双击 `start-monitor.cmd`，或执行 `npm start` / `npm run dev`。需要 Windows 10/11 x64、.NET Framework 4.x 和 OBS 32.2.x x64。自动查找 `D:\obs-studio` 或默认 Program Files 安装目录，也可设置 `OBS_ROOT`。不需要安装 npm 依赖，不修改现有 OBS 配置，不启动 HTTP 服务。

```powershell
npm run build:native
npm run test:native
npm run package:native
```

打包命令下载并校验固定版本的官方运行库和源码，生成 `releases/LiveMultiviewer-0.1.0-preview-win-x64-*.zip`，避免被网页构建清空。采用全新目录和文件白名单，排除直播配置、日志、Git 与本地 OBS 插件。对方完整解压后双击 `LiveMultiviewer.exe`，无需安装 OBS 或开发环境；若缺少系统级 Microsoft Visual C++ v14 x64 运行库，按包内说明从微软安装。

原生版包括 3×3 九路预览、同地址共享解码、监听、聚焦、布局排序、重连、分辨率、音频电平和信号异常提示。每个不同地址拥有独立的接入、解码和重连生命周期；完全相同的地址才共享同一个 OBS 媒体源。OBS 网络媒体缓冲保持原有的 2 MB，避免未经实机验证的零缓冲设置影响连接；九路延迟仍须在目标 Windows 设备验证。配置用 Windows 当前用户加密，保存在 `.runtime/native-settings.dat`；已有六路配置会保留并自动补出三个未配置窗口。首次运行可读取旧 `.runtime/settings.json`，但不覆盖它。原生版当前不显示源帧率/码率，也不直接采集 USB 摄像头或 OBS 场景。

自检使用本地合成媒体验证真实 libobs 解码、九路绘制、八个不同输入加一路同源复用、状态检测、来源替换和释放。尚未验证九个不同地址同时运行，也未证明真实直播达到 OBS 同等延迟或完成长时间稳定性验证，分发包标记为试用版。完整操作、验证边界与开源许可见 [分发说明](native/DISTRIBUTION.md)。新原生代码与分发脚本采用 GPL-3.0-or-later；原网页代码的许可声明未更改。

以下章节描述保留的旧网页版本。

## 当前能力

- 3×3 九路视频同时监看，九个窗口均绑定独立视频来源。
- 每格拥有独立播放器会话；相同地址共享一条网关媒体管线，避免重复接入和转码。
- 单击监听、双击聚焦、Esc 返回多画面。
- 每个窗口均有视频地址入口；空地址显示未配置黑场，不生成演示画面。
- RTSP、RTMP、SRT、HLS、HTTP-FLV、HTTP-TS、MP4、WebM 均进入同一媒体网关，统一输出最高 1280×720、30fps 的 H.264/AAC HLS 监看流，避免不同来源显示不同指标和九路高规格转码积累延迟。
- 来源配置由本机网关持久化，新打开的监看页面读取同一份配置。
- 来源配置、拖动排序、布局锁定、全部重连和状态事件记录。
- 实际分辨率、浏览器解码帧率、输出码率、实时音频电平、连接状态和单路故障原因显示。
- 网关检测持续静帧、黑场和静音；异常稳定三秒后才写入值守记录，连接瞬态不刷屏。

## 环境

- Node.js 20.19、22.13 或 24 及以上受支持版本
- npm 10 或更高版本
- FFmpeg / FFprobe（用于统一媒体格式、信号分析和集成验证）

## 启动

```bash
npm ci
npm run legacy
```

访问 <http://127.0.0.1:4173>。

`npm run legacy` 同时启动网页和本机媒体网关：

- 监看页面：`http://127.0.0.1:4173`
- 媒体网关：`http://127.0.0.1:4174`

点击“视频源设置”或任一窗口右上角“设置”填写地址。地址留空即不连接。运行配置保存在被 Git 忽略的 `.runtime/settings.json`。

## 验证

```bash
npm run check
```

实际检查链包括 ESLint、Prettier、单元测试、真实 FFmpeg/媒体网关集成测试和 Vite
生产构建。集成测试会在临时目录生成实时音视频，覆盖同窗替换、多窗同源、多窗异源、HLS
切片、H.264/AAC、帧率、码率、音频电平、公共配置和停止清理，不依赖演示画面或外网来源。

需要查看代码覆盖明细时运行：

```bash
npm run test:coverage
```

## 工程结构

```text
LiveMultiviewer/
├── docs/architecture.md
├── scripts/develop.js
├── server/media-gateway.js
├── src/
│   ├── app/
│   ├── domain/
│   ├── infrastructure/
│   ├── media/
│   ├── shared/
│   ├── ui/
│   └── main.js
├── tests/
├── .editorconfig
├── .gitignore
├── .prettierrc.json
├── eslint.config.js
├── index.html
├── package-lock.json
├── package.json
└── vite.config.js
```

详细的职责、依赖方向和项目不变量见 [工程架构](docs/architecture.md)。

## 当前边界

当前媒体网关采用 FFmpeg 将每路来源统一编码为 H.264/AAC HLS。它是本机单用户实现，默认仅监听
`127.0.0.1`；需要让其他局域网设备访问时，应补充鉴权、TLS 和明确的监听地址配置后再开放。

HLS 当前优先解决兼容性；浏览器支持 hls.js 时优先由它播放，原生 HLS 作为回退。已配置客户端缓冲
限制并关闭单路卡顿后的目标延迟递增；实际长时间运行效果
尚未验证，且仍不适合要求亚秒级反应的切换判断。网页若成为正式低延迟工作面，应采用 WebRTC/WHEP
或等价实时输出。
不同来源没有共同的源端时间戳时，软件只能防止本地链路继续积压，不能把各来源原本不同的采集、
编码和网络延迟强行对齐。九路 1080p 的资源占用、告警阈值和 96 小时稳定性仍需使用最终设备与
全部实际来源验证。
