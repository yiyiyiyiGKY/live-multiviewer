import test from "node:test";
import assert from "node:assert/strict";

import { BrowserStateRepository } from "../../src/infrastructure/browser-state-repository.js";

class MemoryStorage {
  constructor(entries = []) {
    this.data = new Map(entries);
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    this.data.set(key, String(value));
  }
}

test("无存储数据时返回九路默认设置", () => {
  const repository = new BrowserStateRepository(new MemoryStorage());
  const settings = repository.loadSettings();
  assert.equal(settings.sources.length, 9);
  assert.equal(settings.layoutLocked, true);
});

test("新命名空间保存并恢复布局设置", () => {
  const storage = new MemoryStorage();
  const repository = new BrowserStateRepository(storage);
  const settings = repository.loadSettings();
  settings.sources[0].name = "一号来源";
  repository.saveSettings({ ...settings, layoutLocked: false });

  const restoredSettings = repository.loadSettings();
  assert.equal(restoredSettings.sources[0].name, "一号来源");
  assert.equal(restoredSettings.layoutLocked, false);
  assert.ok(storage.getItem("live-multiviewer.settings.v1"));
});

test("事件记录最多保留一百条", () => {
  const storage = new MemoryStorage();
  const repository = new BrowserStateRepository(storage);
  repository.saveEvents(Array.from({ length: 120 }, (_, id) => ({ id })));
  assert.equal(repository.loadEvents().length, 100);
});
