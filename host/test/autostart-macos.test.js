import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlist,
  candidatePattern,
  isHostProcess,
  main,
  resolveStableNodePath,
} from "../scripts/autostart-macos.mjs";

test("buildPlist includes launchd host service fields", () => {
  const plist = buildPlist({
    nodePath: "/usr/local/bin/node",
    hostDir: "/Users/me/claude-pokemon-buddy/host",
  });

  assert.match(plist, /<key>Label<\/key>\s*<string>com\.claude-pokemon-buddy\.host<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/Users\/me\/claude-pokemon-buddy\/host\/src\/index\.js<\/string>/);
  assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/me\/claude-pokemon-buddy\/host<\/string>/);
  assert.match(plist, /<key>StandardOutPath<\/key>\s*<string>\/Users\/me\/claude-pokemon-buddy\/host\/out\/host\.log<\/string>/);
  assert.match(plist, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/me\/claude-pokemon-buddy\/host\/out\/host\.log<\/string>/);
});

test("buildPlist escapes XML special characters in paths", () => {
  const plist = buildPlist({
    nodePath: "/opt/a&b/node<dev>",
    hostDir: "/Users/me/A&B/<host>",
  });

  assert.match(plist, /\/opt\/a&amp;b\/node&lt;dev&gt;/);
  assert.match(plist, /\/Users\/me\/A&amp;B\/&lt;host&gt;\/src\/index\.js/);
  assert.doesNotMatch(plist, /\/opt\/a&b\/node<dev>/);
});

test("buildPlist emits a complete plist document", () => {
  const plist = buildPlist({
    nodePath: "/usr/bin/node",
    hostDir: "/tmp/cpb-host",
  });

  assert.ok(plist.startsWith("<?xml"));
  assert.ok(plist.trimEnd().endsWith("</plist>"));
});

test("buildPlist normalizes a trailing hostDir slash", () => {
  const plist = buildPlist({
    nodePath: "/usr/bin/node",
    hostDir: "/tmp/cpb-host/",
  });

  assert.match(plist, /<string>\/tmp\/cpb-host\/src\/index\.js<\/string>/);
  assert.match(plist, /<string>\/tmp\/cpb-host\/out\/host\.log<\/string>/);
  assert.doesNotMatch(plist, /\/tmp\/cpb-host\/\//);
});

test("buildPlist emits nodePath before index.js in ProgramArguments", () => {
  const plist = buildPlist({
    nodePath: "/opt/homebrew/bin/node",
    hostDir: "/tmp/cpb-host",
  });

  const array = plist.match(/<array>([\s\S]*?)<\/array>/)[1];
  const nodeIdx = array.indexOf("/opt/homebrew/bin/node");
  const indexIdx = array.indexOf("/tmp/cpb-host/src/index.js");
  assert.ok(nodeIdx >= 0 && indexIdx >= 0);
  assert.ok(nodeIdx < indexIdx, "nodePath must precede index.js");
});

test("candidatePattern broadly matches relative and absolute invocations", () => {
  const re = new RegExp(candidatePattern());

  assert.ok(re.test("node src/index.js"));
  assert.ok(re.test("/opt/homebrew/bin/node /a+b (x)/host/src/index.js"));
  // Escaped dot must be literal.
  assert.ok(!re.test("node src/index_js"));
});

test("isHostProcess matches cmdline containing the absolute index.js path", () => {
  assert.equal(
    isHostProcess({
      cmdline: "/opt/homebrew/bin/node /Users/me/cpb/host/src/index.js",
      cwd: "/somewhere/else",
      hostDir: "/Users/me/cpb/host",
    }),
    true,
  );
});

test("isHostProcess matches relative cmdline when cwd equals hostDir", () => {
  assert.equal(
    isHostProcess({
      cmdline: "node src/index.js",
      cwd: "/Users/me/cpb/host",
      hostDir: "/Users/me/cpb/host",
    }),
    true,
  );
});

test("isHostProcess rejects an unrelated project's instance", () => {
  assert.equal(
    isHostProcess({
      cmdline: "node /other/proj/src/index.js",
      cwd: "/other/proj",
      hostDir: "/Users/me/cpb/host",
    }),
    false,
  );
});

test("isHostProcess normalizes trailing slashes on cwd and hostDir", () => {
  assert.equal(
    isHostProcess({
      cmdline: "node src/index.js",
      cwd: "/Users/me/cpb/host/",
      hostDir: "/Users/me/cpb/host",
    }),
    true,
  );
  assert.equal(
    isHostProcess({
      cmdline: "node src/index.js",
      cwd: "/Users/me/cpb/host",
      hostDir: "/Users/me/cpb/host///",
    }),
    true,
  );
});

test("isHostProcess rejects when cwd is unavailable and cmdline is relative", () => {
  for (const cwd of [null, undefined]) {
    assert.equal(
      isHostProcess({
        cmdline: "node src/index.js",
        cwd,
        hostDir: "/Users/me/cpb/host",
      }),
      false,
    );
  }
});

test("resolveStableNodePath returns candidate matching execPath realpath", () => {
  const result = resolveStableNodePath({
    execPath: "/opt/homebrew/Cellar/node/24.0.0/bin/node",
    candidates: ["/opt/homebrew/bin/node", "/usr/local/bin/node"],
    exists: (p) => p === "/opt/homebrew/bin/node",
    realpath: (p) =>
      p === "/opt/homebrew/bin/node"
        ? "/opt/homebrew/Cellar/node/24.0.0/bin/node"
        : p,
  });
  assert.equal(result, "/opt/homebrew/bin/node");
});

test("resolveStableNodePath falls back to execPath when no candidate exists", () => {
  const execPath = "/opt/homebrew/Cellar/node/24.0.0/bin/node";
  const result = resolveStableNodePath({
    execPath,
    candidates: ["/opt/homebrew/bin/node"],
    exists: () => false,
    realpath: (p) => p,
  });
  assert.equal(result, execPath);
});

test("resolveStableNodePath falls back when candidate realpath differs", () => {
  const execPath = "/opt/homebrew/Cellar/node/24.0.0/bin/node";
  const result = resolveStableNodePath({
    execPath,
    candidates: ["/usr/bin/node"],
    exists: () => true,
    realpath: (p) => (p === execPath ? "/real/execPath" : "/real/other"),
  });
  assert.equal(result, execPath);
});

test("resolveStableNodePath falls back when candidate realpath throws", () => {
  const execPath = "/opt/homebrew/Cellar/node/24.0.0/bin/node";
  const result = resolveStableNodePath({
    execPath,
    candidates: ["/usr/bin/node"],
    exists: () => true,
    realpath: (p) => {
      if (p === execPath) return "/real/execPath";
      throw new Error("ENOENT");
    },
  });
  assert.equal(result, execPath);
});

test("resolveStableNodePath falls back when execPath realpath throws", () => {
  const execPath = "/broken/node";
  const result = resolveStableNodePath({
    execPath,
    candidates: ["/opt/homebrew/bin/node"],
    exists: () => true,
    realpath: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(result, execPath);
});

test("main platform guard returns 1 on non-darwin", async () => {
  assert.equal(await main(["status"], { platform: "win32" }), 1);
});

test("main returns 1 on missing subcommand (usage) under darwin", async () => {
  assert.equal(await main([], { platform: "darwin" }), 1);
});

test("main returns 1 on unknown subcommand under darwin", async () => {
  assert.equal(await main(["bogus"], { platform: "darwin" }), 1);
});
