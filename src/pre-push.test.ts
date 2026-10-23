import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hook = join(import.meta.dir, "..", ".githooks", "pre-push");
const dir = mkdtempSync(join(tmpdir(), "pre-push-test-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The test process may itself run inside a git hook; drop its GIT_* variables
// so every command below acts only on the scratch repositories.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

function git(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString()}`);
  }
  return run.stdout.toString().trim();
}

function commit(cwd: string, file: string, message: string) {
  writeFileSync(join(cwd, file), `${message}\n`);
  git(cwd, "add", file);
  git(cwd, "commit", "--quiet", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

test(
  "pre-push trial merge leaves the pushing checkout and the pushed commit untouched",
  () => {
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    git(dir, "init", "--quiet", "--bare", "--initial-branch=main", origin);
    git(dir, "clone", "--quiet", origin, work);
    git(work, "config", "user.name", "Test");
    git(work, "config", "user.email", "test@example.invalid");
    git(work, "symbolic-ref", "HEAD", "refs/heads/main");

    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({ name: "scratch", private: true, scripts: { typecheck: "true", test: "true" } }),
    );
    const install = Bun.spawnSync(["bun", "install", "--silent"], { cwd: work, env });
    expect(install.exitCode).toBe(0);
    git(work, "add", "-A");
    git(work, "commit", "--quiet", "-m", "start");
    git(work, "push", "--quiet", "origin", "main");

    // Git exports GIT_DIR to hooks only when pushing from a linked worktree,
    // so the feature branch lives in one, as in the loops' checkouts.
    const feature = join(dir, "feature");
    git(work, "worktree", "add", "--quiet", "-b", "feature", feature);
    commit(feature, "feature.txt", "feature one");
    git(feature, "push", "--quiet", "origin", "feature");

    commit(work, "main.txt", "main moves on");
    git(work, "push", "--quiet", "origin", "main");

    const pushed = commit(feature, "feature.txt", "feature two");

    const hooks = join(dir, "hooks");
    mkdirSync(hooks);
    copyFileSync(hook, join(hooks, "pre-push"));
    git(work, "config", "core.hooksPath", hooks);

    const push = Bun.spawnSync(["git", "push", "--quiet", "origin", "feature"], {
      cwd: feature,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(push.stderr.toString()).toContain("is behind main");
    expect(push.exitCode).toBe(0);
    expect(git(feature, "rev-parse", "HEAD")).toBe(pushed);
    expect(git(feature, "status", "--porcelain")).toBe("");
    expect(git(origin, "rev-parse", "refs/heads/feature")).toBe(pushed);
    // The main checkout and the feature worktree; the trial-merge one is gone.
    expect(git(work, "worktree", "list").split("\n")).toHaveLength(2);
  },
  60_000,
);
