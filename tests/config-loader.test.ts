import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import YAML from "js-yaml";
import {
  clearConfigCache,
  loadConfig,
  saveConfig,
} from "../lib/memory/config-loader.ts";

const tmpDir = path.join(os.tmpdir(), "hana-test-config-" + Date.now());
const configPath = path.join(tmpDir, "config.yaml");
const hanakoHome = path.join(tmpDir, ".hanako");

function writeYaml(obj) {
  fs.writeFileSync(configPath, YAML.dump(obj), "utf-8");
}

function readYaml() {
  return YAML.load(fs.readFileSync(configPath, "utf-8"));
}

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(hanakoHome, { recursive: true });
  process.env.SATORI_HOME = hanakoHome;
  clearConfigCache();
});

afterEach(() => {
  clearConfigCache();
  delete process.env.SATORI_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads basic api config", () => {
    writeYaml({ api: { provider: "openai", api_key: "sk-test", base_url: "https://api.openai.com/v1" } });
    const cfg = loadConfig(configPath);
    expect(cfg.api.provider).toBe("openai");
    expect(cfg.api.api_key).toBe("sk-test");
  });

  it("returns the same object while cached", () => {
    writeYaml({ api: { provider: "openai", api_key: "sk-test", base_url: "https://api.openai.com/v1" } });
    const a = loadConfig(configPath);
    const b = loadConfig(configPath);
    expect(a).toBe(b);
  });

  it("reloads config after clearConfigCache", () => {
    writeYaml({ api: { provider: "openai", api_key: "sk-1", base_url: "https://api.openai.com/v1" } });
    const a = loadConfig(configPath);
    clearConfigCache();
    writeYaml({ api: { provider: "openai", api_key: "sk-2", base_url: "https://api.openai.com/v1" } });
    const b = loadConfig(configPath);
    expect(a.api.api_key).toBe("sk-1");
    expect(b.api.api_key).toBe("sk-2");
  });

  it("keeps embedding_api null when not configured", () => {
    writeYaml({ api: { provider: "openai", api_key: "sk-test", base_url: "https://api.openai.com/v1" } });
    const cfg = loadConfig(configPath);
    expect(cfg.embedding_api).toBeNull();
  });

  it("does not inject a default provider when provider is missing", () => {
    writeYaml({ api: { api_key: "sk-test", base_url: "https://api.openai.com/v1" } });
    const cfg = loadConfig(configPath);
    expect(cfg.api.provider).toBe("");
  });

  it("returns raw config.yaml values without resolving added-models.yaml", () => {
    fs.writeFileSync(
      path.join(hanakoHome, "added-models.yaml"),
      YAML.dump({
        providers: {
          openai: {
            base_url: "https://api.openai.com/v1",
            api_key: "sk-test",
            api: "openai-completions",
          },
        },
      }),
      "utf-8",
    );
    writeYaml({ api: { provider: "openai" } });
    const cfg = loadConfig(configPath);
    expect(cfg.api.api).toBe("");
    expect(cfg.api.api_key).toBe("");
    expect(cfg.api.provider).toBe("openai");
  });
});

describe("saveConfig", () => {
  it("deep merges object fields", () => {
    writeYaml({
      api: { provider: "openai", api_key: "sk-1", base_url: "https://api.openai.com/v1" },
      user: { name: "Alice" },
    });
    saveConfig(configPath, { user: { age: 18 } });
    const result = readYaml();
    expect(result.user.name).toBe("Alice");
    expect(result.user.age).toBe(18);
    expect(result.api.provider).toBe("openai");
  });

  it("deletes keys when partial value is null", () => {
    writeYaml({ api: { provider: "openai" }, debug: true });
    saveConfig(configPath, { debug: null });
    const result = readYaml();
    expect(result.debug).toBeUndefined();
    expect(result.api.provider).toBe("openai");
  });

  it("overwrites arrays instead of merging them", () => {
    writeYaml({ tags: ["a", "b"] });
    saveConfig(configPath, { tags: ["c"] });
    const result = readYaml();
    expect(result.tags).toEqual(["c"]);
  });

  it("does not leave a tmp file after atomic write", () => {
    writeYaml({ api: { provider: "openai" } });
    saveConfig(configPath, { user: { name: "Test" } });
    const files = fs.readdirSync(tmpDir);
    expect(files).not.toContain("config.yaml.tmp");
    expect(files).toContain("config.yaml");
  });

  it("clears cache after save so loadConfig reads the new value", () => {
    writeYaml({ api: { provider: "openai", api_key: "sk-1", base_url: "https://api.openai.com/v1" } });
    loadConfig(configPath);
    saveConfig(configPath, { api: { api_key: "sk-2" } });
    const cfg = loadConfig(configPath);
    expect(cfg.api.api_key).toBe("sk-2");
  });
});
