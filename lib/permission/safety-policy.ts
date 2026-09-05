const GIT_PUSH_RULES = {
  force: {
    id: "force-push-blocked",
    reason: "Force push is blocked by Satori safety policy.",
  },
  tags: {
    id: "push-tags-blocked",
    reason: "Bulk tag push is blocked by Satori safety policy. Push one explicit tag ref after release review.",
  },
  all: {
    id: "push-all-blocked",
    reason: "Pushing all branches is blocked by Satori safety policy.",
  },
  mirror: {
    id: "push-mirror-blocked",
    reason: "Mirror push is blocked by Satori safety policy.",
  },
};

// L1 灾难红线：任何权限模式（含 operate）直接 block。规则刻意收窄——
// 每条都必须过「正常开发会不会敲这个」检查，误伤优先级高于漏拦的反面。
const CATASTROPHIC_RULES = {
  rmRootRecursive: {
    id: "rm-root-recursive",
    reason: "Recursive forced deletion of a filesystem root is blocked by Satori safety policy.",
  },
  rmNoPreserveRoot: {
    id: "rm-no-preserve-root",
    reason: "rm --no-preserve-root is blocked by Satori safety policy.",
  },
  rdDriveRoot: {
    id: "rd-drive-root",
    reason: "Recursive deletion of a drive root is blocked by Satori safety policy.",
  },
  formatDrive: {
    id: "format-drive",
    reason: "Formatting a drive is blocked by Satori safety policy.",
  },
  diskpart: {
    id: "diskpart-invocation",
    reason: "diskpart is blocked by Satori safety policy.",
  },
  mkfs: {
    id: "mkfs-invocation",
    reason: "Creating a filesystem (mkfs) is blocked by Satori safety policy.",
  },
  ddDevice: {
    id: "dd-write-device",
    reason: "Raw write to a device node via dd is blocked by Satori safety policy.",
  },
};

// L2 高危写操作：非 operate 模式强制人工确认（wrapper 负责模式判定；
// auto 模式人工确认通道不可用，落为拒绝并指引切档）。只读形态不匹配。
const HIGH_RISK_RULES = {
  registryWrite: {
    id: "registry-write",
    reason: "Registry write (reg add/delete) requires explicit user approval.",
  },
  scheduledTaskWrite: {
    id: "scheduled-task-write",
    reason: "Creating or deleting scheduled tasks requires explicit user approval.",
  },
  takeown: {
    id: "takeown-invocation",
    reason: "Taking ownership of files requires explicit user approval.",
  },
  aclWrite: {
    id: "acl-write",
    reason: "Changing file ACLs requires explicit user approval.",
  },
  recursiveDeleteExternal: {
    id: "recursive-delete-external",
    reason: "Recursive deletion outside the workspace requires explicit user approval.",
  },
};

const ACL_WRITE_SWITCHES = new Set(["/grant", "/deny", "/remove", "/reset", "/save", "/restore"]);

function commandFromRequest(request: any = {}) {
  // chars：write_stdin / terminal write 向已运行 PTY 注入的文本——
  // 若不纳入，operate 模式下可借 stdin 注入绕过 L1 硬拦。
  const command = request.params?.command || request.params?.cmd || request.params?.chars || request.target?.label;
  return typeof command === "string" ? command : "";
}

function tokenizeCommand(command) {
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (token) tokens.push(token);
      token = "";
      continue;
    }
    token += char;
  }
  if (token) tokens.push(token);
  return tokens;
}

function executableBasename(token) {
  const normalized = String(token || "").replace(/\\/g, "/").toLowerCase();
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function isGitExecutableToken(token) {
  const base = executableBasename(token);
  return base === "git" || base === "git.exe";
}

function nestedShellCommand(tokens, index) {
  const base = executableBasename(tokens[index]);
  const isPosixShell = base === "sh" || base === "sh.exe"
    || base === "bash" || base === "bash.exe"
    || base === "zsh" || base === "zsh.exe"
    || base === "fish" || base === "fish.exe";
  if (isPosixShell) {
    for (let i = index + 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === "--") return null;
      if (token === "-c" || (/^-[^-]+$/.test(token) && token.includes("c"))) return tokens[i + 1] || null;
      if (!token.startsWith("-")) return null;
    }
    return null;
  }

  const isPowerShell = base === "powershell" || base === "powershell.exe"
    || base === "pwsh" || base === "pwsh.exe";
  if (isPowerShell) {
    for (let i = index + 1; i < tokens.length; i += 1) {
      const token = String(tokens[i] || "").toLowerCase();
      if (token === "-command" || token === "-c" || token === "/c") return tokens[i + 1] || null;
    }
    return null;
  }

  if (base === "cmd" || base === "cmd.exe") {
    for (let i = index + 1; i < tokens.length; i += 1) {
      const token = String(tokens[i] || "").toLowerCase();
      if (token === "/c" || token === "-c") return tokens[i + 1] || null;
    }
  }
  return null;
}

// 嵌套 shell 解包（bash -c / powershell -command / cmd /c，最多 3 层）：
// 访问每一层的每个 token 位置，各规则表都在解包后的命令上匹配。
function forEachCommand(command, depth, visit) {
  const tokens = tokenizeCommand(command);
  for (let i = 0; i < tokens.length; i += 1) {
    if (depth < 3) {
      const nested = nestedShellCommand(tokens, i);
      if (nested) forEachCommand(nested, depth + 1, visit);
    }
    visit(tokens, i);
  }
}

function gitGlobalOptionConsumesValue(token) {
  if (token.includes("=")) return false;
  return token === "-C"
    || token === "-c"
    || token === "--git-dir"
    || token === "--work-tree"
    || token === "--namespace"
    || token === "--exec-path"
    || token === "--config-env"
    || token === "--super-prefix";
}

function detectGitPush(command) {
  let result = null;
  forEachCommand(command, 0, (tokens, i) => {
    if (result || !isGitExecutableToken(tokens[i])) return;
    let j = i + 1;
    while (j < tokens.length) {
      const token = tokens[j];
      if (token === "push") {
        const args = tokens.slice(j + 1);
        result = {
          hasForce: args.some((arg) => arg === "-f"
            || arg === "--force"
            || arg.startsWith("--force-with-lease")
            || arg.startsWith("+")),
          hasTags: args.includes("--tags") || args.includes("--follow-tags"),
          hasAll: args.includes("--all"),
          hasMirror: args.includes("--mirror"),
        };
        return;
      }
      if (token === "--") return;
      if (token.startsWith("-")) {
        j += gitGlobalOptionConsumesValue(token) ? 2 : 1;
        continue;
      }
      return;
    }
  });
  return result;
}

function splitPosixArgs(tokens, index) {
  const flags = { recursive: false, force: false, noPreserveRoot: false };
  const targets = [];
  for (let j = index + 1; j < tokens.length; j += 1) {
    const token = tokens[j];
    if (token === "--") break;
    if (token.startsWith("-")) {
      const lower = token.toLowerCase();
      if (lower === "--recursive") flags.recursive = true;
      else if (lower === "--force") flags.force = true;
      else if (lower === "--no-preserve-root") flags.noPreserveRoot = true;
      else if (!lower.startsWith("--")) {
        if (lower.includes("r")) flags.recursive = true;
        if (lower.includes("f")) flags.force = true;
      }
      continue;
    }
    targets.push(token);
  }
  return { flags, targets };
}

function splitCmdArgs(tokens, index): { switches: Set<string>; targets: string[] } {
  const switches = new Set<string>();
  const targets: string[] = [];
  for (let j = index + 1; j < tokens.length; j += 1) {
    const token = String(tokens[j] || "");
    if (token.startsWith("/")) {
      // cmd 开关可连写且顺序任意（/s/q、/q/s）；带值开关（/grant:r）先剥 :值，
      // 再登记前缀链与独立段，保证 has("/s") 对两种连写都命中。
      const head = token.toLowerCase().split(":")[0];
      const segments = head.split("/").filter(Boolean);
      let chain = "";
      for (const segment of segments) {
        chain += `/${segment}`;
        switches.add(chain);
        switches.add(`/${segment}`);
      }
    } else targets.push(token);
  }
  return { switches, targets };
}

function isFilesystemRootTarget(token) {
  return token === "/" || token === "/*" || token === "~" || token === "~/*";
}

function isDriveRootTarget(token) {
  return token === "/" || /^[a-z]:[\\\/]?$/i.test(token);
}

// 工作区外形状判定（不看 cwd）：绝对路径 / 盘符路径 / ~ / 上级跳转。
// 相对路径视为工作区内（rm -rf node_modules 不该被提升）。
function isExternalPathTarget(token) {
  return isFilesystemRootTarget(token)
    || token.startsWith("/")
    || token.startsWith("~")
    || token.startsWith("..")
    || token.startsWith("\\\\")
    || /^[a-z]:/i.test(token);
}

function detectCatastrophicRule(tokens, index) {
  const base = executableBasename(tokens[index]);
  if (base === "rm" || base === "rm.exe") {
    const { flags, targets } = splitPosixArgs(tokens, index);
    if (flags.noPreserveRoot) return CATASTROPHIC_RULES.rmNoPreserveRoot;
    if (flags.recursive && flags.force && targets.some(isFilesystemRootTarget)) {
      return CATASTROPHIC_RULES.rmRootRecursive;
    }
    return null;
  }
  // rd 与 rmdir 是 cmd 同一命令的两个名字，rmdir /s 反而是更常见写法；
  // POSIX rmdir 没有 /s 开关，不会因此误伤。
  if (base === "rd" || base === "rd.exe" || base === "rmdir" || base === "rmdir.exe") {
    const { switches, targets } = splitCmdArgs(tokens, index);
    if (switches.has("/s") && targets.some(isDriveRootTarget)) return CATASTROPHIC_RULES.rdDriveRoot;
    return null;
  }
  if (base === "format" || base === "format.com" || base === "format.exe") {
    const { targets } = splitCmdArgs(tokens, index);
    if (targets.some((token) => /^[a-z]:/i.test(token))) return CATASTROPHIC_RULES.formatDrive;
    return null;
  }
  if (base.startsWith("diskpart")) return CATASTROPHIC_RULES.diskpart;
  if (base.startsWith("mkfs")) return CATASTROPHIC_RULES.mkfs;
  if (base === "dd" || base === "dd.exe") {
    for (let j = index + 1; j < tokens.length; j += 1) {
      if (String(tokens[j] || "").toLowerCase().startsWith("of=/dev/")) {
        return CATASTROPHIC_RULES.ddDevice;
      }
    }
    return null;
  }
  return null;
}

function detectHighRiskRule(tokens, index) {
  const base = executableBasename(tokens[index]);
  if (base === "reg" || base === "reg.exe") {
    const { targets } = splitCmdArgs(tokens, index);
    const sub = String(targets[0] || "").toLowerCase();
    if (sub === "add" || sub === "delete") return HIGH_RISK_RULES.registryWrite;
    return null;
  }
  if (base === "schtasks" || base === "schtasks.exe") {
    const { switches } = splitCmdArgs(tokens, index);
    if (switches.has("/create") || switches.has("/delete")) return HIGH_RISK_RULES.scheduledTaskWrite;
    return null;
  }
  if (base === "takeown" || base === "takeown.exe") return HIGH_RISK_RULES.takeown;
  if (base === "icacls" || base === "icacls.exe") {
    const { switches } = splitCmdArgs(tokens, index);
    for (const switchName of switches) {
      if (ACL_WRITE_SWITCHES.has(switchName)) return HIGH_RISK_RULES.aclWrite;
    }
    return null;
  }
  if (base === "rm" || base === "rm.exe") {
    // L2 只要求递归（-f 非必需）：rm -r /outside 对普通文件同样无提示删除。
    const { flags, targets } = splitPosixArgs(tokens, index);
    if (flags.recursive && targets.some(isExternalPathTarget)) {
      return HIGH_RISK_RULES.recursiveDeleteExternal;
    }
    return null;
  }
  if (base === "rd" || base === "rd.exe" || base === "rmdir" || base === "rmdir.exe" || base === "del" || base === "del.exe") {
    const { switches, targets } = splitCmdArgs(tokens, index);
    if (switches.has("/s") && targets.some(isExternalPathTarget)) {
      return HIGH_RISK_RULES.recursiveDeleteExternal;
    }
    return null;
  }
  return null;
}

function collectRules(command, detector) {
  const rules = [];
  forEachCommand(command, 0, (tokens, i) => {
    const rule = detector(tokens, i);
    if (rule && !rules.includes(rule)) rules.push(rule);
  });
  return rules;
}

export function evaluateToolSafetyPolicy(request: any = {}) {
  const command = commandFromRequest(request);
  if (!command) return null;
  const rules = collectRules(command, detectCatastrophicRule);
  const gitPush = detectGitPush(command);
  if (gitPush) {
    const rule = gitPush.hasForce
      ? GIT_PUSH_RULES.force
      : gitPush.hasMirror
        ? GIT_PUSH_RULES.mirror
        : gitPush.hasAll
          ? GIT_PUSH_RULES.all
          : gitPush.hasTags
            ? GIT_PUSH_RULES.tags
            : null;
    if (rule) rules.push(rule);
  }
  if (!rules.length) return null;
  return {
    action: "block",
    code: "ACTION_BLOCKED_BY_SAFETY_POLICY",
    reviewer: "safety_policy",
    reason: rules.map((rule) => rule.reason).join(" "),
    risk: "critical",
    ruleIds: rules.map((rule) => rule.id),
  };
}

// L2 判定与模式解耦：只回答「这条命令是否高危」；operate 放行 / deny 不降级 /
// auto 落为拒绝并指引切档的决策在 session-permission-wrapper 里做。
export function evaluateHighRiskCommand(request: any = {}) {
  const command = commandFromRequest(request);
  if (!command) return null;
  const rules = collectRules(command, detectHighRiskRule);
  if (!rules.length) return null;
  return {
    reviewer: "safety_policy",
    risk: "high",
    ruleIds: rules.map((rule) => rule.id),
    reasons: rules.map((rule) => rule.reason),
  };
}
