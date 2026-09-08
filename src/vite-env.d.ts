/// <reference types="vite/client" />

// Just enough of node's child_process for the build stamp in vite.config.ts.
// Declared here rather than pulling in @types/node, which this project has no
// other use for. Delete this block if @types/node is ever added.
declare module "node:child_process" {
  export function execSync(command: string, options: { encoding: "utf8" }): string;
}

declare const __BUILD_COMMIT__: string;
declare const __BUILD_DATE__: string;
