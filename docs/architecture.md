# 工程架构

## Windows 原生入口

默认 `npm start` / `npm run dev` 已改为启动 `native/` 的 Windows 监看程序。它直接加载 OBS 32.2.x 的 `libobs` 与 `obs-ffmpeg`，由 `SourcePool` 按地址共享解码来源，`VideoPanel` 用 D3D11 显示。`MonitorWindow` 管理六路布局与监听，`SettingsStore` 使用 Windows 当前用户加密配置。打包入口为 `native/package.ps1`，分发和验证边界见 [分发说明](../native/DISTRIBUTION.md)。

以下为保留的网页版本架构，仅适用于 `npm run legacy`，其中的本机 HLS 网关不在原生播放路径中。

## 产品边界

Live Multiviewer 是可复用的导播多画面视频监看软件。项目名称和核心领域不绑定特定直播、人物或画面数量。

当前产品配置固定为六路，是首个交付规格；`source` 领域模型支持其他来源数量，后续可在布局配置层扩展四路、九路等规格。

产品的第一目标不是“网页里出现六个播放器”，而是让值守人员在一个屏幕内完成三件事：确认六路真实
画面是否持续推进、确认每路声音是否存在且处于合理电平、在来源异常时立刻知道哪一路和什么原因。
设置、日志和技术信息只能辅助这三件事，不能长期遮挡画面。

## 术语

- `source`：一路独立视频来源，是核心领域对象。
- `source tile`：承载一路来源的监看窗口。
- `media session`：一路来源独立的连接、播放、检测和重连生命周期。
- `media gateway`：把浏览器不能直接播放的输入按路转封装为 HTTP 播放流。
- `health`：来源当前的连接和播放健康状态。
- `layout`：来源在多画面中的排列方式。
- `listening`：只监听某一路音频，不改变视频源本身。

禁止在同一含义上混用 `feed`、`channel` 和 `source`。本项目统一使用 `source`。

## 模块职责

```text
src/
├── app/              应用流程编排，不实现媒体或存储细节
├── domain/           来源和健康状态等纯业务规则
├── infrastructure/   浏览器存储等外部环境适配
├── media/            每路独立媒体会话
├── shared/           无业务状态的通用函数
├── ui/               DOM、组件和样式
└── main.js           唯一启动入口
server/
├── ffmpeg-command.js 统一编码与信号检测参数
├── ffmpeg-metrics.js FFmpeg 输出指标解析
└── media-gateway.js  本机配置存储、逐路进程管理和 HLS 服务
```

依赖方向为：`main → app → domain`。UI、媒体和基础设施由应用层组合，领域层不依赖 DOM、浏览器存储或播放器。浏览器客户端通过 `GatewayClient` 访问网关，不直接创建 FFmpeg 进程。

## 不变量

1. 每个可见监看窗口只绑定一个 `sourceId`。
2. 每路来源拥有独立的 `SourceMediaSession`。
3. 单路重连、静音或断流不能重建其他来源的媒体会话，配置整体变更除外。
4. 告警、运行状态和操作控件不能占用视频窗口。
5. 来源地址在界面或诊断信息中展示前必须脱敏。
6. 未配置来源必须显示空监看位，不能以演示内容替代真实信号。
7. 每个唯一来源地址对应一条 FFmpeg 媒体管线；多个窗口使用同一地址时共享该管线，但播放器、监听和 UI 状态仍按窗口独立。
8. 布局锁定只控制拖动排序，不得阻止修改来源地址。
9. 不因协议或编码不同改变画面信息、音频表、故障判断和操作入口。
10. 连接、缓冲等短暂状态实时显示，但只有稳定三秒的异常才进入值守事件记录。

## 媒体链路

```text
RTSP / RTMP / SRT / HTTP(S)
             │
             ▼
     每路独立 FFmpeg 会话
     ├─ 最高 1280×720、30fps / H.264 / AAC / 48 kHz / 双声道归一化
     ├─ 1 秒关键帧与 HLS 切片
     ├─ 帧率、码率、RMS 电平
     └─ 静帧、黑场、持续静音检测
             │
             ▼
        HLS 浏览器播放
             │
             └─ 实际分辨率、浏览器解码帧率、停播检测
```

网关负责协议、编码和可观测指标归一化；`SourceMediaSession` 合并网关分析与浏览器实际解码结果。
两段都成功才是可用画面，不能以“FFmpeg 进程存在”代替用户真正看到持续视频。

## 成熟实现中采用的共性

- [OBS Multiview](https://obsproject.com/kb/power-of-projectors)：多画面可独立窗口或全屏显示。因此本项目把全屏和固定六格作为主工作面，不把配置页当主界面。
- [vMix Inputs](https://www.vmix.com/help28/Inputs.html) 与 [Fullscreen](https://www.vmix.com/help28/Fullscreen.html)：输入与布局分离，画面保留标题和音频表，并支持点选输入。因此本项目把单击监听、双击放大和逐格设置放在同一套通用交互里。
- [Blackmagic MultiView](https://www.blackmagicdesign.com/products/multiview/techspecs/)：自定义标签、音频表和不同输入格式在每个视图中一致显示。因此本项目先统一媒体与指标，再渲染六格，不为某一协议做特例界面。
- [Haivision StreamHub Multi-View](https://doc.haivision.com/StreamHub/4.4/setting-a-multi-view)：多画面可按行列配置、每格显示音频表，整张拼图只监听一个来源。因此本项目默认全部静音，单击后仅监听一路。
- [Grass Valley Kaleido-IP](https://www.grassvalley.com/products/multiviewers-hardware/kaleido-ip/)：专业监看不仅确认连接，还检测静帧、静音等信号质量。因此本项目把内容异常与连接异常纳入同一健康模型。
- [TAG Audio Monitoring](https://tagvs.com/features/audio-monitoring/) 与 [Penalty Box](https://tagvs.com/features/penalty-box/)：告警应有阈值，只把需要处理的来源推到操作员面前。因此本项目先做三秒去抖和集中事件栏；异常专注视图列为下一阶段。
- [MediaMTX](https://mediamtx.org/docs/kickoff/introduction)：成熟媒体路由器统一接入 RTSP、RTMP、SRT、HLS、WebRTC，并提供控制 API 与指标。当前内置网关保持相同的“来源、媒体转换、指标、UI”分层，便于后续替换为成熟媒体服务。

没有照搬的功能包括切换台 Preview/Program、Tally、录制、PTZ 和返送。这些属于制作控制或传输系统，
当前目标是可信监看；提前加入会扩大权限和故障面。

## 操作体验验收

1. 打开页面后，已配置来源自动连接，未配置窗口保持安静黑场且只有填写地址入口。
2. 六格始终以视频为主体，每格同时可见源名、当前状态、分辨率、帧率、码率和音频表。
3. 单击任一格只监听该路，双击放大，再次双击或按 Esc 返回六格。
4. 同一来源可填入多个窗口；网关只接入和转换一次，每格仍有独立播放器、监听和呈现状态。
5. 同一窗口更换地址后生成新播放会话并清理旧媒体，不把旧画面留作“在线”。
6. 断流、静帧、黑场和预期有声却持续静音能显示可读原因；短暂连接抖动不刷满事件记录。

## 当前技术边界

网关当前输出标准 HLS，优先保证协议兼容和故障隔离；对低于 2 秒端到端延迟有要求时，应增加
WebRTC 或专用低延迟输出，不应通过缩短 UI 轮询间隔伪装低延迟。MediaMTX 等成熟媒体路由器可以
作为后续替换方案，内置 FFmpeg 网关保留为零额外服务的本机实现。

运行配置集中保存在本机 `.runtime/settings.json`，不同浏览器页面可读取同一份来源配置。该实现尚不提供多用户权限、远程开放或密钥加密存储。

开发、生产构建、代码检查和格式化分别由 Vite、ESLint 和 Prettier 提供，不维护自造的构建或检查脚本。
