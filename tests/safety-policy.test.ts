import { describe, expect, it, vi } from "vitest";
import { evaluateToolSafetyPolicy, evaluateHighRiskCommand } from "../lib/permission/safety-policy.ts";

function request(overrides = {}) {
  return {
    id: "approval-1",
    kind: "tool_action",
    sessionPath: "/tmp/hana/session.jsonl",
    agentId: "hana",
    toolName: "bash",
    actionName: "execute",
    params: { command: "git push origin main" },
    target: { type: "command", label: "git push origin main" },
    blastRadius: "external",
    reversibility: "hard",
    ...overrides,
  };
}

describe("SafetyPolicy", () => {
  it("does not block ordinary git push so it can use normal Hana permissions", () => {
    const decision = evaluateToolSafetyPolicy(request());

    expect(decision).toBeNull();
  });

  it("detects git push through global git options", () => {
    expect(evaluateToolSafetyPolicy(request({
      params: { command: "git -C /repo push origin main" },
      target: { type: "command", label: "git -C /repo push origin main" },
    }))).toBeNull();
    expect(evaluateToolSafetyPolicy(request({
      params: { command: "git --git-dir /repo/.git push origin --tags" },
      target: { type: "command", label: "git --git-dir /repo/.git push origin --tags" },
    }))).toMatchObject({
      action: "block",
      ruleIds: ["push-tags-blocked"],
    });
    expect(evaluateToolSafetyPolicy(request({
      params: { command: "git -c user.name=hana push --force-with-lease origin main" },
      target: { type: "command", label: "git -c user.name=hana push --force-with-lease origin main" },
    }))).toMatchObject({
      action: "block",
      ruleIds: ["force-push-blocked"],
    });
    expect(evaluateToolSafetyPolicy(request({
      params: { command: "git push --all origin" },
      target: { type: "command", label: "git push --all origin" },
    }))).toMatchObject({
      action: "block",
      ruleIds: ["push-all-blocked"],
    });
    expect(evaluateToolSafetyPolicy(request({
      params: { command: "git push --mirror origin" },
      target: { type: "command", label: "git push --mirror origin" },
    }))).toMatchObject({
      action: "block",
      ruleIds: ["push-mirror-blocked"],
    });
  });

  it("detects git push nested inside common shell command arguments", () => {
    expect(evaluateToolSafetyPolicy(request({
      params: { command: "bash -lc \"cd /repo && git push origin main\"" },
      target: { type: "command", label: "bash -lc \"cd /repo && git push origin main\"" },
    }))).toBeNull();
    expect(evaluateToolSafetyPolicy(request({
      params: { command: "pwsh -NoProfile -Command \"git.exe push --tags\"" },
      target: { type: "command", label: "pwsh -NoProfile -Command \"git.exe push --tags\"" },
    }))).toMatchObject({
      action: "block",
      ruleIds: ["push-tags-blocked"],
    });
    expect(evaluateToolSafetyPolicy(request({
      params: { command: "cmd.exe /c \"git push --force origin main\"" },
      target: { type: "command", label: "cmd.exe /c \"git push --force origin main\"" },
    }))).toMatchObject({
      action: "block",
      ruleIds: ["force-push-blocked"],
    });
  });

  it("does not block unrelated commands that happen to use --force", () => {
    const marker = vi.fn();
    const decision = evaluateToolSafetyPolicy(request({
      params: { command: "npm install left-pad@1.3.0 --force" },
      target: { type: "command", label: "npm install left-pad@1.3.0 --force" },
    }));

    if (!decision) marker();
    expect(decision).toBeNull();
    expect(marker).toHaveBeenCalledOnce();
  });
});

describe("SafetyPolicy catastrophic rules (L1, blocked in every mode)", () => {
  function cmd(command: string) {
    return request({
      params: { command },
      target: { type: "command", label: command },
    });
  }

  it("blocks recursive forced deletion of filesystem roots", () => {
    for (const command of [
      "rm -rf /",
      "rm -rf /*",
      "rm -rf ~",
      "rm -fr ~/*",
      "rm --recursive --force /",
      "sudo rm -rf /",
      "RM -RF /",
      "rm -rf \"/\"",
      "bash -c \"rm -rf /\"",
      "bash -lc \"cd / && rm -rf /*\"",
    ]) {
      expect(evaluateToolSafetyPolicy(cmd(command)), command).toMatchObject({
        action: "block",
        code: "ACTION_BLOCKED_BY_SAFETY_POLICY",
        ruleIds: ["rm-root-recursive"],
      });
    }
  });

  it("blocks rm --no-preserve-root regardless of target", () => {
    expect(evaluateToolSafetyPolicy(cmd("rm --no-preserve-root /tmp/scratch"))).toMatchObject({
      action: "block",
      ruleIds: ["rm-no-preserve-root"],
    });
  });

  it("blocks drive-root deletion and disk destruction commands", () => {
    expect(evaluateToolSafetyPolicy(cmd("cmd /c rd /s /q C:\\"))).toMatchObject({
      action: "block",
      ruleIds: ["rd-drive-root"],
    });
    expect(evaluateToolSafetyPolicy(cmd("cmd /c rmdir /s /q C:\\"))).toMatchObject({
      action: "block",
      ruleIds: ["rd-drive-root"],
    });
    expect(evaluateToolSafetyPolicy(cmd("rd /s/q C:\\"))).toMatchObject({
      action: "block",
      ruleIds: ["rd-drive-root"],
    });
    expect(evaluateToolSafetyPolicy(cmd("cmd.exe /c \"rd /s /q C:/\""))).toMatchObject({
      action: "block",
      ruleIds: ["rd-drive-root"],
    });
    expect(evaluateToolSafetyPolicy(cmd("format c: /fs:ntfs"))).toMatchObject({
      action: "block",
      ruleIds: ["format-drive"],
    });
    expect(evaluateToolSafetyPolicy(cmd("powershell -Command \"format d:\""))).toMatchObject({
      action: "block",
      ruleIds: ["format-drive"],
    });
    expect(evaluateToolSafetyPolicy(cmd("diskpart"))).toMatchObject({
      action: "block",
      ruleIds: ["diskpart-invocation"],
    });
    expect(evaluateToolSafetyPolicy(cmd("echo backup && diskpart /s script.txt"))).toMatchObject({
      action: "block",
      ruleIds: ["diskpart-invocation"],
    });
    expect(evaluateToolSafetyPolicy(cmd("mkfs.ext4 /dev/sdb1"))).toMatchObject({
      action: "block",
      ruleIds: ["mkfs-invocation"],
    });
    expect(evaluateToolSafetyPolicy(cmd("dd if=boot.iso of=/dev/sda"))).toMatchObject({
      action: "block",
      ruleIds: ["dd-write-device"],
    });
  });

  it("does not block ordinary workspace deletion and unrelated commands", () => {
    for (const command of [
      "rm -rf node_modules",
      "rm -rf ./build",
      "rm -rf /tmp/scratch",
      "format",
      "dd if=a of=b.img",
      "icacls C:\\data",
      "rmdir /s /q build",
    ]) {
      expect(evaluateToolSafetyPolicy(cmd(command)), command).toBeNull();
    }
  });

  it("treats PTY stdin injection (chars) as command surface for L1", () => {
    expect(evaluateToolSafetyPolicy(request({
      params: { chars: "format c:\r" },
      target: { type: "tool", label: "write_stdin" },
    }))).toMatchObject({
      action: "block",
      ruleIds: ["format-drive"],
    });
  });
});

describe("SafetyPolicy high-risk rules (L2, forced user confirmation outside operate)", () => {
  function cmd(command: string) {
    return {
      params: { command },
      target: { type: "command", label: command },
    };
  }

  it("matches write-shaped registry and scheduled-task commands", () => {
    expect(evaluateHighRiskCommand(cmd("reg add HKCU\\Software\\Satori /v Test /d 1"))).toMatchObject({
      reviewer: "safety_policy",
      risk: "high",
      ruleIds: ["registry-write"],
    });
    expect(evaluateHighRiskCommand(cmd("reg delete HKCU\\Software\\Satori /v Test /f"))).toMatchObject({
      ruleIds: ["registry-write"],
    });
    expect(evaluateHighRiskCommand(cmd("schtasks /create /tn demo /tr cmd"))).toMatchObject({
      ruleIds: ["scheduled-task-write"],
    });
    expect(evaluateHighRiskCommand(cmd("schtasks /delete /tn demo /f"))).toMatchObject({
      ruleIds: ["scheduled-task-write"],
    });
  });

  it("does not match read-shaped registry, scheduled-task and acl commands", () => {
    expect(evaluateHighRiskCommand(cmd("reg query HKCU\\Software\\Satori"))).toBeNull();
    expect(evaluateHighRiskCommand(cmd("schtasks /run /tn demo"))).toBeNull();
    expect(evaluateHighRiskCommand(cmd("icacls C:\\data"))).toBeNull();
  });

  it("matches ownership changes, acl writes and external recursive deletes", () => {
    expect(evaluateHighRiskCommand(cmd("takeown /f C:\\data"))).toMatchObject({
      ruleIds: ["takeown-invocation"],
    });
    expect(evaluateHighRiskCommand(cmd("icacls C:\\data /grant Users:F"))).toMatchObject({
      ruleIds: ["acl-write"],
    });
    expect(evaluateHighRiskCommand(cmd("rm -rf /home/me/other-project"))).toMatchObject({
      ruleIds: ["recursive-delete-external"],
    });
    expect(evaluateHighRiskCommand(cmd("rm -rf ~/projects"))).toMatchObject({
      ruleIds: ["recursive-delete-external"],
    });
    expect(evaluateHighRiskCommand(cmd("rm -rf ../sibling"))).toMatchObject({
      ruleIds: ["recursive-delete-external"],
    });
    expect(evaluateHighRiskCommand(cmd("rd /s /q D:\\old"))).toMatchObject({
      ruleIds: ["recursive-delete-external"],
    });
    expect(evaluateHighRiskCommand(cmd("del /s /q C:\\temp"))).toMatchObject({
      ruleIds: ["recursive-delete-external"],
    });
    expect(evaluateHighRiskCommand(cmd("bash -c \"rm -rf /opt\""))).toMatchObject({
      ruleIds: ["recursive-delete-external"],
    });
  });

  it("matches recursive deletes without -f and chained cmd switches", () => {
    expect(evaluateHighRiskCommand(cmd("rm -r /home/me/other-project"))).toMatchObject({
      ruleIds: ["recursive-delete-external"],
    });
    expect(evaluateHighRiskCommand(cmd("del /s/q C:\\temp"))).toMatchObject({
      ruleIds: ["recursive-delete-external"],
    });
  });

  it("does not elevate workspace-relative deletes", () => {
    expect(evaluateHighRiskCommand(cmd("rm -rf node_modules"))).toBeNull();
    expect(evaluateHighRiskCommand(cmd("rm -r node_modules"))).toBeNull();
    expect(evaluateHighRiskCommand(cmd("rm -rf ./build"))).toBeNull();
    expect(evaluateHighRiskCommand(cmd("del /s /q build"))).toBeNull();
  });
});
