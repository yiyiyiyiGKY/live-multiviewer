# Live Multiviewer 0.1.0 试用版

这是 Windows 九路直播监看程序。包内已包含 OBS 32.2.1 媒体运行库，不需要安装 OBS、Node.js、npm 或 FFmpeg。

## 开始使用

1. 把整个 ZIP 解压到可以写入的目录，例如桌面。不要在压缩软件里直接运行 EXE。
2. 双击 `LiveMultiviewer.exe`。
3. 点击“视频源设置”，填写各机位的名称和播放地址，保存。地址留空表示停用该路。
4. 单击画面开启/关闭监听，双击放大，Esc 返回，F11 全屏。解锁布局后可拖动排序。

适用系统：Windows 10/11 64 位、支持 Direct3D 11 的显卡与正常驱动、.NET Framework 4.x。显卡、网络和解码能力决定可同时播放的视频规格。

若启动提示 `DllNotFoundException`、`VCRUNTIME140.dll` 或 `MSVCP140.dll` 缺失，打开包内 `Microsoft-VC-Runtime.url`，从微软官网下载并安装最新 **Visual C++ v14 x64** 运行库，再重试。它是操作系统层面的前置组件，没有从其他电脑复制系统 DLL 到此包。离线使用前应先准备好此运行库。

## 播放地址

支持 OBS FFmpeg 媒体源能够解码的 HTTP/HTTPS、RTSP、RTMP、SRT 视频地址。直播间网页通常不能直接播放，需要真实媒体地址以及访问权限。HLS 地址可以播放，但仍受上游 HLS 分片延迟影响。

与 OBS 比较时，两边必须使用同一个媒体地址、同一网络和对应媒体源设置。本程序采用 OBS 媒体源直接解码和 D3D11 显示，不经过旧版的本机 HLS 转码。它不能消除摄像机编码、直播平台转发或上游切片造成的延迟，也不等同于 OBS 本地采集卡/窗口捕捉。

当前不支持直接选择 USB 摄像头、采集卡或 OBS 场景；这版输入是网络媒体地址。

## 状态提示与数据

显示分辨率、音频电平、连接状态，以及持续黑场、持续静止、持续静音提示。“画面持续静止”也可能是内容本来没有变化，提示不能替代值守判断。此版没有测量实际网络码率、源帧率或端到端延迟。

设置和最近 100 条状态记录保存到程序旁的 `.runtime`，使用 Windows 当前账户加密。初次分发包不含任何直播地址、私有配置或日志。配置不能直接跨电脑/账户迁移；换电脑需要重新填写。再次转发时请发送原始 ZIP，不要打包自己已经使用过的目录。

关闭监看窗口会停止本程序创建的媒体源。程序不启动本地 HTTP 服务，不修改已安装 OBS 的场景和配置。

## 验证范围

九路版本的 `self-test.cmd` 使用九路本地合成音视频检查真实 libobs 解码与 D3D11 绘制、同源复用、单路监听、聚焦/排序、黑场/静止/静音检测、来源替换和资源释放，以及 Windows 加密配置读写；它不访问直播地址。发布九路安装包前必须先在 Windows 目标机通过该自检。

本包属于试用版，尚未完成不同电脑的兼容性测试、真实九路直播的延迟对照、断网恢复和长时间直播压力测试。用于正式直播前，先在目标电脑与实际九路源上彩排，并保留现有监看方式。未承诺达到 OBS 相同延迟或连续多日稳定运行。

## 源码与许可

`source/native` 是此可执行文件的 C# 源码和构建脚本，以 GNU GPL v3 或更新版本分发，许可全文见 `source/native/LICENSE`。它只依赖 .NET Framework 和包内原生运行库；原项目的网页、服务端、Git 记录和用户配置不在本包中。

在 Windows 上双击 `source/rebuild.cmd` 可用 .NET Framework 的 C# 编译器重新构建，生成 `source/.runtime/native/LiveMultiviewer.exe`。构建不需要安装 npm 依赖。

`source/upstream` 包含对应 OBS、OBS 依赖构建脚本（含补丁）、FFmpeg 及所用第三方库的源码快照。`licenses` 保留上游许可，`source/inputs.json` 记录版本来源与 SHA-256；这些原生库未由本项目修改。Mbed TLS 的 framework 子模块源码需解压到其 `framework` 目录。FFmpeg 和依赖库的构建参数、补丁和版本以 obs-deps 源码中的 `deps.ffmpeg/*.ps1` 为准；OBS 构建入口见其源码的 `CMakePresets.json`。源码编译可能需要上游注明的编译工具，使用现成程序不需要这些工具。

本软件不是 OBS Project 官方产品。OBS 版权所有归 OBS Project 及其贡献者；其他依赖的版权与许可证以各源码包和 `licenses` 中的文件为准。Microsoft 运行库适用微软自己的条款，不属于 GPL 软件。

依据：[OBS 32.2.1 发布页](https://github.com/obsproject/obs-studio/releases/tag/32.2.1)、[OBS 源码与许可](https://github.com/obsproject/obs-studio/tree/32.2.1)、[OBS 依赖构建](https://github.com/obsproject/obs-deps/tree/2026-07-15)、[微软运行库说明](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)。
