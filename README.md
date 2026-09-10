# Live Multiviewer

通用的导播多画面视频监看软件。当前版本实现首个六路监看规格，但项目名称、领域模型和模块边界不绑定特定直播或固定路数。

## 当前能力

- 3×2 六路视频同时监看，六个窗口均绑定独立视频来源。
- 每格拥有独立播放器会话；相同地址共享一条网关媒体管线，避免重复接入和转码。
- 单击监听、双击聚焦、Esc 返回多画面。
- 每个窗口均有视频地址入口；空地址显示未配置黑场，不生成演示画面。
- RTSP、RTMP、SRT、HLS、HTTP-FLV、HTTP-TS、MP4、WebM 均进入同一媒体网关，统一输出最高 1280×720、30fps 的 H.264/AAC HLS 监看流，避免不同来源显示不同指标和六路高规格转码积累延迟。
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
npm run dev
```

访问 <http://127.0.0.1:4173>。

`npm run dev` 同时启动网页和本机媒体网关：

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

HLS 当前优先解决兼容性，端到端延迟不适合要求亚秒级反应的切换判断；后续低延迟阶段应采用
WebRTC 或等价实时输出。六路 1080p 同时转码的资源占用、告警阈值和 96 小时稳定性仍需使用最终
设备与全部实际来源验证。
