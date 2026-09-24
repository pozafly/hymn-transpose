import { spawn } from "node:child_process";
// Kill the entire process group: script launchers can otherwise leave children alive.
export function command(
  binary: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    maxBuffer?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      size = 0,
      reason = "";
    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      reason = "실행 시간이 초과되었습니다.";
      kill();
    }, options.timeout ?? 60_000);
    const collect = (kind: "stdout" | "stderr", chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxBuffer ?? 8 * 1024 * 1024)) {
        reason = "실행 로그가 너무 큽니다.";
        kill();
        return;
      }
      if (kind === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on("data", (c) => collect("stdout", c));
    child.stderr.on("data", (c) => collect("stderr", c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(Object.assign(e, { stdout, stderr }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !reason) resolve({ stdout, stderr });
      else
        reject(
          Object.assign(new Error(reason || `${binary} 실행 실패 (${code})`), {
            code,
            stdout,
            stderr,
          }),
        );
    });
  });
}
