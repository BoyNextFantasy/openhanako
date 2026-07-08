import fs from "node:fs";
import path from "node:path";

const workspace = process.argv[2];
if (!workspace) {
  console.error("Usage: node solution.mjs <workspace>");
  process.exit(1);
}

fs.writeFileSync(
  path.join(workspace, "sum.js"),
  "export function sum(a, b) {\n  return a + b;\n}\n",
  "utf8",
);
