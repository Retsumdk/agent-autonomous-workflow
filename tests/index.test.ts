import { describe, test, expect, afterAll } from "bun:test";
import { spawnSync } from "child_process";
import { rmSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");

function runCli(args: string[]) {
  const proc = spawnSync("bun", ["src/index.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  return { code: proc.status, out: (proc.stdout || "") + (proc.stderr || "") };
}

afterAll(() => {
  rmSync(join(root, "workflows"), { recursive: true, force: true });
});

describe("CLI", () => {
  test("--help lists the workflow commands", () => {
    const { code, out } = runCli(["--help"]);
    expect(code).toBe(0);
    for (const command of ["create", "execute", "list", "status", "cancel"]) {
      expect(out).toContain(command);
    }
  });

  test("create turns a task description into a ready workflow", () => {
    const { code, out } = runCli(["create", "Deploy the staging server and run smoke tests", "--name", "smoke-flow"]);
    expect(code).toBe(0);
    expect(out).toContain("Created workflow:");
    expect(out).toContain("smoke-flow");
    expect(out).toContain("Status: ready");
  });

  test("list shows the stored workflow", () => {
    const { code, out } = runCli(["list"]);
    expect(code).toBe(0);
    expect(out).toContain("smoke-flow");
  });
});
