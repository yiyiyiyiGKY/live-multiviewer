import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["server/media-gateway.js"], { stdio: "inherit" }),
  spawn("vite", [], { stdio: "inherit" }),
];
let stopping = false;

for (const child of children) {
  child.once("exit", (exitCode, signal) => {
    if (stopping) return;
    stopping = true;
    for (const runningChild of children) runningChild.kill("SIGTERM");
    process.exitCode = signal ? 1 : (exitCode ?? 1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    for (const child of children) child.kill(signal);
  });
}
