import { BrowserStateRepository } from "./browser-state-repository.js";

export class SharedStateRepository {
  constructor({ storage, gatewayClient }) {
    this.localRepository = new BrowserStateRepository(storage);
    this.gatewayClient = gatewayClient;
  }

  async loadSettings() {
    try {
      const sharedSettings = await this.gatewayClient.loadSettings();
      if (sharedSettings) {
        this.localRepository.saveSettings(sharedSettings);
        return this.localRepository.loadSettings();
      }
    } catch {
      // 网关未启动时仍允许使用浏览器内的上一次配置。
    }

    const localSettings = this.localRepository.loadSettings();
    this.gatewayClient.saveSettings(localSettings).catch(() => {});
    return localSettings;
  }

  saveSettings(settings) {
    this.localRepository.saveSettings(settings);
    this.gatewayClient.saveSettings(settings).catch(() => {});
  }

  loadEvents() {
    return this.localRepository.loadEvents();
  }

  saveEvents(events) {
    this.localRepository.saveEvents(events);
  }
}
