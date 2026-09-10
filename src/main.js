import { MonitorApplication } from "./app/monitor-application.js";
import { GatewayClient } from "./infrastructure/gateway-client.js";
import { SharedStateRepository } from "./infrastructure/shared-state-repository.js";
import { collectDomElements } from "./ui/dom-elements.js";

const gatewayClient = new GatewayClient();
const monitorApplication = new MonitorApplication({
  elements: collectDomElements(),
  stateRepository: new SharedStateRepository({ storage: window.localStorage, gatewayClient }),
  gatewayClient,
});

await monitorApplication.start();
window.addEventListener("beforeunload", () => monitorApplication.stop(), { once: true });
