process.loadEnvFile?.(".env.local");

const url = process.env.IMAGE_RUNNER_URL ?? "http://localhost:3000/api/image-runner";
const intervalMs = Number(process.env.IMAGE_RUNNER_INTERVAL_MS ?? 2000);
const batchSize = Number(process.env.IMAGE_RUNNER_BATCH_SIZE ?? 4);
const secret = process.env.IMAGE_RUNNER_SECRET ?? process.env.CRON_SECRET;

if (!Number.isInteger(intervalMs) || intervalMs < 500) {
  throw new Error("IMAGE_RUNNER_INTERVAL_MS must be an integer >= 500.");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
  throw new Error("IMAGE_RUNNER_BATCH_SIZE must be an integer between 1 and 10.");
}

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ batchSize }),
    });
    const body = await response.text();
    if (!response.ok) {
      console.error(`[image-runner] HTTP ${response.status}: ${body}`);
      return;
    }
    console.log(`[image-runner] ${new Date().toISOString()} ${body}`);
  } catch (error) {
    console.error("[image-runner]", error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
  }
}

console.log(`[image-runner] polling ${url} every ${intervalMs}ms, batchSize=${batchSize}`);
void tick();
setInterval(tick, intervalMs);
