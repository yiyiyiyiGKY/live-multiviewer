const REQUIRED_ELEMENTS = Object.freeze({
  sourceGrid: "#source-grid",
  lockButton: "#lock-button",
  configButton: "#config-button",
  reconnectButton: "#reconnect-button",
  fullscreenButton: "#fullscreen-button",
  runtime: "#runtime",
  clock: "#clock",
  gatewayStatus: "#gateway-status",
  eventCount: "#event-count",
  eventMessage: "#event-message",
  eventsButton: "#events-button",
  eventDrawer: "#event-drawer",
  closeEventsButton: "#close-events-button",
  clearEventsButton: "#clear-events-button",
  configDialog: "#config-dialog",
  configForm: "#config-form",
  configFields: "#config-fields",
  eventList: "#event-list",
  toast: "#toast",
});

export function collectDomElements(root = document) {
  return Object.fromEntries(
    Object.entries(REQUIRED_ELEMENTS).map(([name, selector]) => {
      const element = root.querySelector(selector);
      if (!element) throw new Error(`缺少必要界面节点：${selector}`);
      return [name, element];
    }),
  );
}
