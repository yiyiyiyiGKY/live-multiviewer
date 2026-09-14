import test from "node:test";
import assert from "node:assert/strict";

import { MonitorApplication, sameSourceConfiguration } from "../../src/app/monitor-application.js";
import { createDefaultSources } from "../../src/domain/source.js";

test("重排九路窗口只改变显示顺序，不销毁现有播放会话", () => {
  const savedSettings = [];
  const application = new MonitorApplication({
    elements: {},
    stateRepository: { saveSettings: (settings) => savedSettings.push(settings) },
    gatewayClient: {},
  });
  application.showToast = () => {};
  application.state.sources = createDefaultSources();

  let disposed = 0;
  for (const source of application.state.sources) {
    application.state.sourceTiles.set(source.id, { root: { style: {} } });
    application.state.mediaSessions.set(source.id, { dispose: () => disposed++ });
  }

  application.reorderSource("source-1", "source-3");

  assert.deepEqual(
    application.state.sources.map((source) => source.id),
    [
      "source-2",
      "source-3",
      "source-1",
      "source-4",
      "source-5",
      "source-6",
      "source-7",
      "source-8",
      "source-9",
    ],
  );
  assert.equal(disposed, 0);
  assert.equal(application.state.mediaSessions.size, 9);
  assert.equal(application.state.sourceTiles.get("source-2").root.style.order, 0);
  assert.equal(application.state.sourceTiles.get("source-1").root.style.order, 2);
  assert.equal(savedSettings.length, 1);
});

test("只有名称、地址或音频预期变化才需要替换播放会话", () => {
  const source = createDefaultSources()[0];
  assert.equal(sameSourceConfiguration(source, { ...source }), true);
  assert.equal(sameSourceConfiguration(source, { ...source, name: "其他名称" }), false);
  assert.equal(
    sameSourceConfiguration(source, { ...source, url: "rtsp://example.com/live" }),
    false,
  );
  assert.equal(sameSourceConfiguration(source, { ...source, audioExpected: false }), false);
});

test("更换地址时会等待旧网关流停止，不停止未改动的来源", async () => {
  const stopped = [];
  let finishStop;
  const stopPending = new Promise((resolve) => {
    finishStop = resolve;
  });
  const application = new MonitorApplication({
    elements: {},
    stateRepository: {},
    gatewayClient: {
      stopStream: (id) => {
        stopped.push(id);
        return stopPending;
      },
    },
  });
  const previous = [
    { id: "source-1", url: "rtsp://example.com/old" },
    { id: "source-2", url: "rtsp://example.com/same" },
  ];
  const next = [
    { id: "source-1", url: "rtsp://example.com/new" },
    { id: "source-2", url: "rtsp://example.com/same" },
  ];
  let completed = false;
  const stopping = application.stopReplacedGatewaySources(previous, next).then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.deepEqual(stopped, ["source-1"]);
  assert.equal(completed, false);
  finishStop();
  await stopping;
  assert.equal(completed, true);
});
