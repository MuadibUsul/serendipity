// npm run docs:state-machines: rewrites the generated part of docs/state-machines.md.
import { readFile, writeFile } from "node:fs/promises";

import { withCurrentLifecycles } from "./state-machines.js";

const path = new URL("../../../docs/state-machines.md", import.meta.url);
await writeFile(path, withCurrentLifecycles(await readFile(path, "utf8")));
process.stdout.write("docs/state-machines.md updated\n");
