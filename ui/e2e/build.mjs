import { execFileSync } from "node:child_process";

// Use Node directly: POSIX inline environment assignments fail in cmd.exe,
// which is npm's default script shell on Windows.
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  { stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--outDir",
    "dist-e2e",
    "--emptyOutDir",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, VITE_SHADOW_TEST_TRANSPORT: "1" },
  },
);
