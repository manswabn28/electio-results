import { importAllEnabledHistoryArchives } from "./constituencyHistory.js";

async function main() {
  const startedAt = Date.now();
  const summaries = await importAllEnabledHistoryArchives();
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), elapsedSeconds, profiles: summaries }, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
