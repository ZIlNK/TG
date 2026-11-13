import { readFile, writeFile, unlink } from "node:fs/promises";
const body = await readFile(
  new URL("../lib/client-body.js", import.meta.url),
  "utf8",
);
await writeFile(
  new URL("../lib/client.js", import.meta.url),
  `window.__ModuleLoader__.load({id:"dsh-tg",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${body}\nreturn module.exports;}});\n`,
);
await unlink(new URL("../lib/client-body.js", import.meta.url));
