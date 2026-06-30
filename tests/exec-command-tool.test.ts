import { describe, expect, it, vi } from "vitest";
import { createExecCommandTools } from "../lib/exec-command/tool.ts";

function makeCtx(sessionPath = "/tmp/session.jsonl", cwd = "/tmp/work") {
  return {
    sessionManager: {
      getSessionFile: () => sessionPath,
      getCwd: () => cwd,
    },
  };
}

describe("exec_command tools", () => {
  it("routes one-shot commands through the wrapped bash tool and returns nonzero exits as structured output", async () => {
    const bashTool = {
      execute: vi.fn(async () => {
        throw new Error("Command exited with code 127\npython: not found");
      }),
    };
    const [execCommand] = createExecCommandTools({
      bashTool,
      getCwd: () => "/tmp/work",
      platform: "win32",
    });

    const result: any = await execCommand.execute("call-1", {
      cmd: "python --version",
      max_output_tokens: 1000,
    }, null, null, makeCtx());

    expect(bashTool.execute).toHaveBeenCalledWith(
      "call-1",
      { command: "python --version" },
      null,
      null,
      expect.any(Object),
    );
    expect(result.content[0].text).toContain("python: not found");
    expect(result.details.execCommand).toMatchObject({
      ok: false,
      exitCode: 127,
      errorCode: "EXEC_COMMAND_DEPENDENCY_MISSING",
      shell: "powershell",
      classification: { kind: "probe" },
    });
  });

  it("starts tty processes through the terminal manager and write_stdin writes to the same process id", async () => {
    const manager = {
      start: vi.fn(async (input) => ({ ...input, terminalId: "term_1", status: "running", seq: 0, output: "" })),
      write: vi.fn((input) => ({ ...input, status: "running", seq: 1 })),
    };
    const [execCommand, writeStdin] = createExecCommandTools({
      bashTool: { execute: vi.fn() },
      getTerminalSessionManager: () => manager,
      getAgentId: () => "hana",
      getCwd: () => "/tmp/work",
      platform: "linux",
    });
    const ctx = makeCtx("/tmp/session.jsonl", "/tmp/work");

    const started: any = await execCommand.execute("call-tty", {
      cmd: "npm run dev",
      tty: true,
    }, null, null, ctx);
    const parsedStart = JSON.parse(started.content[0].text);

    expect(parsedStart.process_id).toBe("term_1");
    expect(manager.start).toHaveBeenCalledWith(expect.objectContaining({
      sessionPath: "/tmp/session.jsonl",
      agentId: "hana",
      cwd: "/tmp/work",
      command: "npm run dev",
    }));

    const written: any = await writeStdin.execute("call-stdin", {
      process_id: parsedStart.process_id,
      chars: "q\n",
    }, null, null, ctx);
    const parsedWrite = JSON.parse(written.content[0].text);

    expect(parsedWrite).toMatchObject({
      sessionPath: "/tmp/session.jsonl",
      terminalId: "term_1",
      chars: "q\n",
    });
  });

  it("returns a targeted Windows syntax error instead of invoking the runner for POSIX heredocs", async () => {
    const bashTool = { execute: vi.fn() };
    const [execCommand] = createExecCommandTools({
      bashTool,
      getCwd: () => "C:\\work",
      platform: "win32",
    });

    const result: any = await execCommand.execute("call-heredoc", {
      cmd: "python - <<'PY'\nprint('x')\nPY",
    }, null, null, makeCtx("C:\\session.jsonl", "C:\\work"));

    expect(bashTool.execute).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      errorCode: "EXEC_COMMAND_POSIX_SYNTAX_ON_WINDOWS",
      execCommand: { ok: false },
    });
  });
});
