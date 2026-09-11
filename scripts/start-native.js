import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("OBS 原生监看当前支持 Windows x64；网页版本请使用 npm run legacy。");
  process.exitCode = 1;
} else {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      fileURLToPath(new URL("../native/build.ps1", import.meta.url)),
      "-Run",
    ],
    { stdio: "inherit", windowsHide: true },
  );
  child.once("error", () => {
    console.error("无法启动原生监看，请检查 Windows PowerShell 是否可用。");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
