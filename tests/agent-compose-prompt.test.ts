import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Agent } from "../core/agent.ts";

function makeAgent(locale = "en") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-agent-compose-prompt-"));
  const agentsDir = path.join(root, "agents");
  const productDir = path.join(root, "product");
  const userDir = path.join(root, "user");
  fs.mkdirSync(path.join(agentsDir, "hana"), { recursive: true });
  fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(productDir, "yuan", "hanako.md"), "Yuan prompt", "utf-8");
  const agent = new Agent({ id: "hana", agentsDir, productDir, userDir } as any);
  agent._config = {
    locale,
    agent: { name: "Hana", yuan: "hanako" },
    memory: { enabled: false },
    experience: { enabled: false },
    skills: { enabled: [] },
  };
  agent.userName = "User";
  agent.agentName = "Hana";
  return agent;
}

describe("Agent compose workflow prompt", () => {
  it("does not include compose workflow instructions in normal mode", () => {
    const prompt = makeAgent("en").buildSystemPrompt({ forceMemoryEnabled: false });
    expect(prompt).not.toContain("Compose workflow");
    expect(prompt).not.toContain("compose:brainstorm");
  });

  it("includes compose workflow instructions in compose mode", () => {
    const prompt = makeAgent("en").buildSystemPrompt({ forceMemoryEnabled: false, forCompose: true });
    expect(prompt).toContain("Compose workflow");
    expect(prompt).toContain("compose:brainstorm");
    expect(prompt).toContain("does not bypass the current permission mode");
  });

  it("does not include compose workflow instructions when plan mode wins", () => {
    const prompt = makeAgent("en").buildSystemPrompt({
      forceMemoryEnabled: false,
      forCompose: true,
      forPlan: true,
    });
    expect(prompt).not.toContain("Compose workflow");
    expect(prompt).toContain("Plan Mode");
  });
});
