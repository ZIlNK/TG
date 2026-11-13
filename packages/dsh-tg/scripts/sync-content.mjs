import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const root = new URL("../../../", import.meta.url);
const target = new URL("../src/content/", import.meta.url);
const sandbox = { window: {} };
runInNewContext(
  readFileSync(new URL("src/scripts/content.js", root), "utf8"),
  sandbox,
  { timeout: 1000 },
);
writeFileSync(
  new URL("legacy.json", target),
  JSON.stringify(sandbox.window.GameContent.defaults, null, 2) + "\n",
);
const themes = {};
for (const [name, file] of [
  ["dark", "theme-default.css"],
  ["light", "theme-light.css"],
]) {
  const source = readFileSync(new URL("src/styles/" + file, root), "utf8");
  themes[name] = Object.fromEntries(
    [...source.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}
writeFileSync(
  new URL("themes.json", target),
  JSON.stringify(themes, null, 2) + "\n",
);
console.log("已同步现有角色、地点、世界资料与主题变量。");
