#!/usr/bin/env node
import { createRequire as __cowaitRequire } from 'node:module'; const require = __cowaitRequire(import.meta.url);

// src/hook.ts
import { pathToFileURL } from "node:url";

// src/paths.ts
import os from "node:os";
import path2 from "node:path";

// src/runtime.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
var BUNFS = /^\/?(?:\$bunfs[\\/]|b:[\\/]~bun[\\/])/i;
function isBunfsPath(p) {
  let s = p;
  if (s.startsWith("file:")) {
    try {
      s = decodeURIComponent(s.replace(/^file:\/\//, ""));
    } catch {
      s = s.replace(/^file:\/\//, "");
    }
  }
  return BUNFS.test(s);
}
var compiledOverride = null;
function isCompiled() {
  if (compiledOverride !== null) return compiledOverride;
  if (!process.versions.bun) return false;
  const main2 = globalThis.Bun?.main;
  return [typeof main2 === "string" ? main2 : "", import.meta.url, process.argv[1] ?? ""].some((p) => p && isBunfsPath(p));
}

// src/paths.ts
function dataDir() {
  if (process.env.COWAIT_HOME) return process.env.COWAIT_HOME;
  if (isCompiled()) return path2.join(os.homedir(), ".cowait");
  const root = packageRoot();
  if (!root.split(path2.sep).includes("node_modules")) return path2.join(root, "data");
  return path2.join(os.homedir(), ".cowait");
}
function normPath(p) {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:(\/|$)/i.test(s) ? s.toLowerCase() : s;
}
function within(dir, root) {
  const d = normPath(dir);
  const r = normPath(root);
  return d === r || d.startsWith(r + "/");
}
var paths = {
  events: () => path2.join(dataDir(), "events.jsonl"),
  state: () => path2.join(dataDir(), "state.json"),
  config: () => path2.join(dataDir(), "config.json"),
  feedback: () => path2.join(dataDir(), "feedback"),
  decks: () => path2.join(dataDir(), "decks"),
  lock: () => path2.join(dataDir(), "panel.lock")
};

// src/fsutil.ts
import fs from "node:fs";
import path3 from "node:path";
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function parseJson(text) {
  return JSON.parse(text.charCodeAt(0) === 65279 ? text.slice(1) : text);
}
function readJson(file, fallback) {
  try {
    return parseJson(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function appendLine(file, line) {
  ensureDir(path3.dirname(file));
  fs.appendFileSync(file, line + "\n");
}

// src/testdetect.ts
var RUNNERS = /* @__PURE__ */ new Set(["jest", "vitest", "mocha", "ava", "pytest", "py.test", "tox", "nox", "rspec", "phpunit", "ctest", "unittest"]);
var WRAPPERS = /* @__PURE__ */ new Set(["npx", "bunx", "uvx", "time", "sudo", "exec", "env", "command"]);
var RUN_WRAPPERS = /* @__PURE__ */ new Set(["uv", "poetry", "pipenv", "pdm", "hatch", "rye"]);
function segmentIsTest(segment) {
  const w = segment.trim().split(/\s+/).filter(Boolean);
  for (let guard = 0; guard < 6 && w.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || WRAPPERS.has(w[0])) w.shift();
    else if (RUN_WRAPPERS.has(w[0]) && w[1] === "run") w.splice(0, 2);
    else if ((w[0] === "pnpm" || w[0] === "yarn") && (w[1] === "exec" || w[1] === "dlx")) w.splice(0, 2);
    else if (/^python(\d+(\.\d+)?)?(\.exe)?$/.test(w[0]) && w[1] === "-m") w.splice(0, 2);
    else break;
  }
  if (!w.length) return false;
  const cmd = w[0].split(/[\\/]/).pop().replace(/\.(cmd|exe|bat)$/i, "");
  const args = w.slice(1).filter((a) => !a.startsWith("-"));
  if (RUNNERS.has(cmd)) return true;
  if (cmd === "playwright") return args[0] === "test";
  if (["npm", "pnpm", "yarn", "bun"].includes(cmd)) {
    if (args[0] === "test" || args[0] === "t" || args[0]?.startsWith("test:")) return true;
    return args[0] === "run" && /^test(\b|:)/.test(args[1] ?? "");
  }
  if (cmd === "go" || cmd === "dotnet" || cmd === "deno") return args[0] === "test";
  if (cmd === "cargo") return args[0] === "test" || args[0] === "nextest";
  if (cmd === "make") return args.includes("test") || args.includes("check");
  if (/^mvnw?$/.test(cmd)) return args.includes("test") || args.includes("verify");
  if (/^gradlew?$/.test(cmd)) return args.some((a) => a === "test" || a === "check" || a.endsWith(":test"));
  return false;
}
function isTestCommand(command) {
  return command.split(/&&|\|\||;|\||\n/).some(segmentIsTest);
}
var FAIL_PATTERNS = [
  /\b[1-9]\d*\s+(failed|failing|failures?)\b/i,
  /\b[1-9]\d*\s+errors?\b(?!\s*=\s*0)/i,
  /^\s*FAIL\b/m,
  /^--- FAIL/m,
  /test result: FAILED/,
  /\bFAILED\s*\((failures|errors)=/,
  /^FAILED\b/m,
  /Tests?:\s+[^\n]*\b[1-9]\d* failed/i,
  /BUILD FAILURE/
];
var PASS_PATTERNS = [
  /\b\d+\s+(passed|passing)\b/i,
  /test result: ok\b/,
  /^ok\s+\S+/m,
  /^\s*PASS\b/m,
  /^OK(\s*\(|\s*$)/m,
  /\ball tests passed\b/i,
  /BUILD SUCCESS/,
  /Tests?:\s+\d+ passed/i
];
function testOutcome(output) {
  if (!output) return "unknown";
  if (FAIL_PATTERNS.some((r) => r.test(output))) return "fail";
  if (PASS_PATTERNS.some((r) => r.test(output))) return "pass";
  return "unknown";
}

// src/events.ts
var MAX_TEXT = 4e3;
var MAX_PATCH_LINES = 240;
function clip(s, max = MAX_TEXT) {
  const str2 = typeof s === "string" ? s : "";
  return str2.length > max ? str2.slice(0, max) + "\n\u2026" : str2;
}
function str(v) {
  return typeof v === "string" ? v : "";
}
var TITLE_MAX = 60;
function promptTitle(prompt) {
  const line = str(prompt).split(/\r?\n/).map((x) => x.replace(/\s+/g, " ").trim()).find(Boolean);
  if (!line) return void 0;
  const chars = Array.from(line);
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX - 1).join("") + "\u2026" : line;
}
function readPatch(resp) {
  const sp = resp?.structuredPatch;
  if (!Array.isArray(sp) || sp.length === 0) return void 0;
  const out = [];
  let budget = MAX_PATCH_LINES;
  for (const h of sp) {
    if (!h || !Array.isArray(h.lines) || budget <= 0) continue;
    const lines = h.lines.filter((l) => typeof l === "string").slice(0, budget);
    budget -= lines.length;
    out.push({ oldStart: Number(h.oldStart) || 1, newStart: Number(h.newStart) || 1, lines: lines.map((l) => clip(l, 400)) });
  }
  return out.length ? out : void 0;
}
function editInfo(tool, input, resp) {
  const file = str(input?.file_path) || str(input?.notebook_path) || str(resp?.filePath);
  if (!file) return void 0;
  const patch = readPatch(resp);
  switch (tool) {
    case "Edit":
      return { file, kind: "edit", patch, hunks: patch ? void 0 : [{ old: clip(input?.old_string), new: clip(input?.new_string) }] };
    case "MultiEdit": {
      const edits = Array.isArray(input?.edits) ? input.edits : [];
      return {
        file,
        kind: "multiedit",
        patch,
        hunks: patch ? void 0 : edits.slice(0, 12).map((e) => ({ old: clip(e?.old_string, 1500), new: clip(e?.new_string, 1500) }))
      };
    }
    case "Write": {
      const created = resp?.type === "create";
      if (patch && !created) return { file, kind: "write", patch };
      return { file, kind: "write", created, hunks: [{ old: "", new: clip(input?.content) }] };
    }
    case "NotebookEdit":
      return { file, kind: "notebook", hunks: [{ old: "", new: clip(input?.new_source) }] };
    default:
      return void 0;
  }
}
function bashInfo(input, resp) {
  const cmd = str(input?.command);
  if (!cmd) return void 0;
  const test = isTestCommand(cmd);
  let result = "unknown";
  if (test && !resp?.interrupted) {
    const out = typeof resp === "string" ? resp : `${str(resp?.stdout)}
${str(resp?.stderr)}
${str(resp?.output)}`;
    result = testOutcome(out);
  }
  return { cmd: clip(cmd, 300), test, result };
}
function toEvent(p, now, opts = {}) {
  if (!p || typeof p !== "object") return null;
  const sid = str(p.session_id) || "unknown";
  const cwd = str(p.cwd);
  switch (p.hook_event_name) {
    case "UserPromptSubmit": {
      const ev = { t: now, k: "prompt", sid, cwd };
      const title = opts.titles === false ? void 0 : promptTitle(p.prompt);
      if (title) ev.p = title;
      return ev;
    }
    case "PostToolUse": {
      const tool = str(p.tool_name) || "tool";
      const ev = { t: now, k: "tool", sid, cwd, tool };
      const edit = editInfo(tool, p.tool_input, p.tool_response);
      if (edit) ev.edit = edit;
      if (tool === "Bash") {
        const bash = bashInfo(p.tool_input, p.tool_response);
        if (bash) ev.bash = bash;
      }
      return ev;
    }
    case "Stop":
      return { t: now, k: "stop", sid, cwd };
    case "Notification":
      return { t: now, k: "notify", sid, cwd, msg: clip(p.message, 200) };
    case "SessionEnd":
      return { t: now, k: "end", sid };
    default:
      return null;
  }
}

// src/feedback.ts
import fs2 from "node:fs";
import path4 from "node:path";
function isFor(note, cwd, sid) {
  if (note.sid && sid && note.sid === sid) return true;
  if (!note.cwd || !cwd) return true;
  return within(cwd, note.cwd);
}
function noteFiles() {
  try {
    return fs2.readdirSync(paths.feedback()).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}
function claimNotes(cwd, sid) {
  const dir = paths.feedback();
  const out = [];
  for (const f of noteFiles()) {
    const src = path4.join(dir, f);
    let note = null;
    try {
      note = parseJson(fs2.readFileSync(src, "utf8"));
    } catch {
    }
    if (note && typeof note.text === "string" && !isFor(note, cwd, sid)) continue;
    const claimed = `${src}.claimed-${process.pid}`;
    try {
      fs2.renameSync(src, claimed);
    } catch {
      continue;
    }
    try {
      note ??= parseJson(fs2.readFileSync(claimed, "utf8"));
      if (!note || typeof note.text !== "string") throw new Error("not a note");
      out.push(note);
      fs2.unlinkSync(claimed);
    } catch {
      try {
        fs2.renameSync(claimed, `${src}.unreadable`);
      } catch {
      }
    }
  }
  return out;
}
function formatNotes(notes) {
  const lines = notes.map((n) => `- ${n.file ? `${n.file}: ` : ""}"${n.text.replace(/\s+/g, " ").trim()}"`);
  return [
    "[Cowait] While you were working, the user reviewed your recent changes in a side panel and left these notes.",
    "Take them into account now: fix what they point out, or briefly explain why not.",
    ...lines
  ].join("\n");
}

// src/hook.ts
function log(ev) {
  appendLine(paths.events(), JSON.stringify(ev));
}
function hookConfig() {
  const c = readJson(paths.config(), {});
  return { relay: c.feedback !== false, titles: c.promptTitles !== false };
}
function handleHook(raw, now = Date.now()) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  const name = p?.hook_event_name ?? "";
  const sid = typeof p?.session_id === "string" ? p.session_id : "unknown";
  const cwd = typeof p?.cwd === "string" && p.cwd ? p.cwd : void 0;
  const { relay, titles } = hookConfig();
  const ev = toEvent(p, now, { titles });
  if (name === "Stop") {
    if (relay && !p.stop_hook_active) {
      const notes = claimNotes(cwd, sid);
      if (notes.length) {
        log({ t: now, k: "delivered", sid, ids: notes.map((n) => n.id) });
        return JSON.stringify({ decision: "block", reason: formatNotes(notes) });
      }
    }
    if (ev) log(ev);
    return null;
  }
  if (ev) log(ev);
  if (relay && (name === "PostToolUse" || name === "UserPromptSubmit")) {
    const notes = claimNotes(cwd, sid);
    if (notes.length) {
      log({ t: now, k: "delivered", sid, ids: notes.map((n) => n.id) });
      return JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: formatNotes(notes) } });
    }
  }
  return null;
}
function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = "";
    const done = () => resolve(data);
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => data += c);
    process.stdin.on("end", () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      done();
    });
  });
}
async function main() {
  if (process.env.COWAIT_INTERNAL) return;
  const raw = await readStdin(2e3);
  const out = handleHook(raw);
  if (out) await new Promise((resolve) => process.stdout.write(out, () => resolve()));
}
function runHookProcess() {
  const guard = setTimeout(() => process.exit(0), 4e3);
  main().catch(() => void 0).finally(() => {
    clearTimeout(guard);
    process.exit(0);
  });
}
var entryBundle = true;
var isEntry = entryBundle && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) runHookProcess();
export {
  handleHook,
  runHookProcess
};
