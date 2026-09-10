const DEFAULT_GATEWAY_PORT = 4174;

export class GatewayClient {
  constructor({ fetchImplementation = fetch, location = window.location } = {}) {
    this.fetchImplementation = fetchImplementation.bind(globalThis);
    this.baseUrl = `http://${location.hostname}:${DEFAULT_GATEWAY_PORT}`;
  }

  async checkHealth() {
    const response = await this.fetchImplementation(`${this.baseUrl}/api/health`);
    if (!response.ok) throw new Error("媒体网关不可用");
    return response.json();
  }

  async loadSettings() {
    const response = await this.fetchImplementation(`${this.baseUrl}/api/settings`);
    if (!response.ok) throw new Error("无法读取公共配置");
    return (await response.json()).settings;
  }

  async saveSettings(settings) {
    const response = await this.fetchImplementation(`${this.baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    if (!response.ok) throw new Error("无法保存公共配置");
  }

  async resolvePlaybackUrl(source) {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/api/streams/${encodeURIComponent(source.id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url }),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "媒体网关无法接入该地址");
    return result.playbackUrl;
  }

  async getStreamStatus(sourceId) {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/api/streams/${encodeURIComponent(sourceId)}`,
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "无法读取视频源状态");
    return result.stream;
  }

  async stopStream(sourceId) {
    await this.fetchImplementation(`${this.baseUrl}/api/streams/${encodeURIComponent(sourceId)}`, {
      method: "DELETE",
    });
  }
}
