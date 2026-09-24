import test from "node:test";
import assert from "node:assert/strict";
import { command } from "../lib/command.ts";
test("timeouts terminate subprocess descendants that retain stdout", async () => {
  const start = Date.now();
  const script = `require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000)`;
  await assert.rejects(
    command(process.execPath, ["-e", script], { timeout: 150 }),
    /초과/,
  );
  assert.ok(Date.now() - start < 3000);
});
