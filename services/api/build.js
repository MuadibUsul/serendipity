// Bundles the service for its image (see build-options.js).
import { build } from "esbuild";

import { buildOptions } from "./build-options.js";

await build(buildOptions);
