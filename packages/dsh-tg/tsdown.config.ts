import { defineConfig } from "tsdown";
import { readFileSync } from "node:fs";
import ts from "typescript";
export default defineConfig([
  {
    entry: { index: "src/host/index.ts" },
    outDir: "lib",
    format: "esm",
    platform: "node",
    target: "node22",
    clean: true,
    dts: false,
    noExternal: ["zod"],
    external: [/^@deepseek-ai\//],
    outputOptions: { entryFileNames: "[name].js" },
    plugins: [
      {
        name: "tg-standard-decorators",
        transform(code: string, id: string) {
          if (
            id.endsWith("/src/host/index.ts") ||
            id.endsWith("\\src\\host\\index.ts")
          )
            return {
              code: ts.transpileModule(code, {
                compilerOptions: {
                  target: ts.ScriptTarget.ES2022,
                  module: ts.ModuleKind.ESNext,
                },
              }).outputText,
              map: null,
            };
        },
      },
    ],
  },
  {
    entry: { "client-body": "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    target: "es2022",
    clean: false,
    dts: false,
    noExternal: ["zod"],
    external: [/^@deepseek-ai\//, "react", "react/jsx-runtime"],
    outputOptions: { entryFileNames: "[name].js" },
    plugins: [
      {
        name: "tg-css-text",
        load(id: string) {
          if (id.endsWith(".css?raw"))
            return `export default ${JSON.stringify(readFileSync(id.slice(0, -4), "utf8"))}`;
        },
      },
    ],
  },
]);
