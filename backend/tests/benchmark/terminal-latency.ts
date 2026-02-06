/**
 * Terminal latency benchmark
 *
 * Measures the round-trip time for terminal I/O:
 *   Browser (WebSocket send) → Bun → PTY → tmux → PTY → Bun → Browser (WebSocket receive)
 *
 * Usage:
 *   bun run backend/tests/benchmark/terminal-latency.ts [--server URL] [--rounds N]
 *
 * Requires the dev server to be running (bun run dev:backend).
 * Note: Dev server uses HTTPS/WSS (Tailscale TLS). TLS verification is disabled for localhost.
 */

// Disable TLS verification for self-signed / Tailscale certs on localhost
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const SERVER_URL = process.argv.includes('--server')
  ? process.argv[process.argv.indexOf('--server') + 1]
  : 'wss://localhost:3000';

const ROUNDS = process.argv.includes('--rounds')
  ? parseInt(process.argv[process.argv.indexOf('--rounds') + 1], 10)
  : 50;

const WARMUP_ROUNDS = 5;

interface BenchmarkResult {
  name: string;
  rounds: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  stddev: number;
}

function calcStats(name: string, latencies: number[]): BenchmarkResult {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length;
  return {
    name,
    rounds: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(mean * 100) / 100,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    stddev: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

function printResult(result: BenchmarkResult) {
  console.log(`\n--- ${result.name} (${result.rounds} rounds) ---`);
  console.log(`  min:    ${result.min.toFixed(2)} ms`);
  console.log(`  max:    ${result.max.toFixed(2)} ms`);
  console.log(`  mean:   ${result.mean.toFixed(2)} ms`);
  console.log(`  median: ${result.median.toFixed(2)} ms`);
  console.log(`  p95:    ${result.p95.toFixed(2)} ms`);
  console.log(`  p99:    ${result.p99.toFixed(2)} ms`);
  console.log(`  stddev: ${result.stddev.toFixed(2)} ms`);
}

// Create a unique test session
const TEST_SESSION = `cchub-bench-${Date.now()}`;

function httpUrl(path: string): string {
  return SERVER_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') + path;
}

async function createSession(): Promise<void> {
  const res = await fetch(httpUrl('/api/sessions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: TEST_SESSION }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  console.log(`Created test session: ${TEST_SESSION}`);
}

async function deleteSession(): Promise<void> {
  await fetch(httpUrl(`/api/sessions/${TEST_SESSION}`), {
    method: 'DELETE',
  }).catch(() => {});
  console.log(`Deleted test session: ${TEST_SESSION}`);
}

function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SERVER_URL}/ws/terminal/${TEST_SESSION}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
  });
}

/**
 * Benchmark 1: Single character echo latency
 * Send a character, measure time until we see it echoed back in terminal output.
 */
async function benchSingleCharEcho(ws: WebSocket): Promise<BenchmarkResult> {
  const latencies: number[] = [];

  // Wait for shell prompt to be ready
  await new Promise(r => setTimeout(r, 500));

  for (let i = 0; i < WARMUP_ROUNDS + ROUNDS; i++) {
    const marker = String.fromCharCode(65 + (i % 26)); // A-Z
    const start = performance.now();

    const received = new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const text = new TextDecoder().decode(event.data);
          if (text.includes(marker)) {
            ws.removeEventListener('message', handler);
            resolve();
          }
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(marker);
    await received;
    const elapsed = performance.now() - start;

    if (i >= WARMUP_ROUNDS) {
      latencies.push(elapsed);
    }

    // Send backspace to clean up
    ws.send('\x7f');
    await new Promise(r => setTimeout(r, 20));
  }

  return calcStats('Single char echo (keystroke round-trip)', latencies);
}

/**
 * Benchmark 2: Command execution latency
 * Send "echo MARKER\r" and measure time until we see MARKER in output.
 */
async function benchCommandExec(ws: WebSocket): Promise<BenchmarkResult> {
  const latencies: number[] = [];

  await new Promise(r => setTimeout(r, 300));

  for (let i = 0; i < WARMUP_ROUNDS + ROUNDS; i++) {
    const marker = `BENCH_${Date.now()}_${i}`;
    const start = performance.now();

    const received = new Promise<void>((resolve) => {
      let buffer = '';
      const handler = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          buffer += new TextDecoder().decode(event.data);
          // Look for the marker in output (after echo command)
          // The marker appears twice: once in the command line, once in the output
          const parts = buffer.split(marker);
          if (parts.length >= 3) {
            // Seen at least twice (command + output)
            ws.removeEventListener('message', handler);
            resolve();
          }
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(`echo ${marker}\r`);
    await received;
    const elapsed = performance.now() - start;

    if (i >= WARMUP_ROUNDS) {
      latencies.push(elapsed);
    }

    await new Promise(r => setTimeout(r, 30));
  }

  return calcStats('Command execution (echo round-trip)', latencies);
}

/**
 * Benchmark 3: Throughput - large output
 * Send "seq 1 N" and wait for shell prompt ($) to reappear after output completes.
 * Uses a unique echo marker at the end to detect completion.
 */
async function benchThroughput(ws: WebSocket): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  const SEQ_COUNT = 1000;
  const TIMEOUT_MS = 15000;

  await new Promise(r => setTimeout(r, 300));

  for (let i = 0; i < WARMUP_ROUNDS + Math.min(ROUNDS, 10); i++) {
    const doneMarker = `__DONE${i}${Date.now()}__`;
    const start = performance.now();

    // Strategy: Run seq then echo a unique marker.
    // Only look for the marker appearing AFTER seq output (i.e., after we've seen numbers).
    const received = new Promise<void>((resolve, reject) => {
      let buffer = '';
      let seenNumbers = false;
      const timer = setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error(`Throughput bench round ${i} timed out. Buffer tail: ${buffer.slice(-200)}`));
      }, TIMEOUT_MS);
      const handler = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const text = new TextDecoder().decode(event.data);
          buffer += text;
          // Check if we've seen actual seq output
          if (!seenNumbers && buffer.includes('100')) {
            seenNumbers = true;
          }
          // Look for the done marker after seq output has started
          if (seenNumbers && buffer.includes(doneMarker)) {
            clearTimeout(timer);
            ws.removeEventListener('message', handler);
            resolve();
          }
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(`seq 1 ${SEQ_COUNT}; echo ${doneMarker}\r`);
    await received;
    const elapsed = performance.now() - start;

    if (i >= WARMUP_ROUNDS) {
      latencies.push(elapsed);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  return calcStats(`Throughput (seq 1 ${SEQ_COUNT})`, latencies);
}

/**
 * Benchmark 4: Sessions API latency
 * Measure GET /api/sessions response time.
 */
async function benchSessionsApi(): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  const url = httpUrl('/api/sessions');

  for (let i = 0; i < WARMUP_ROUNDS + ROUNDS; i++) {
    const start = performance.now();
    await fetch(url);
    const elapsed = performance.now() - start;

    if (i >= WARMUP_ROUNDS) {
      latencies.push(elapsed);
    }
  }

  return calcStats('Sessions API (GET /api/sessions)', latencies);
}

// Main
async function main() {
  console.log('=== CC Hub Terminal Latency Benchmark ===');
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Rounds: ${ROUNDS} (+ ${WARMUP_ROUNDS} warmup)`);
  console.log(`Date: ${new Date().toISOString()}`);

  const results: BenchmarkResult[] = [];

  try {
    // Setup
    await createSession();
    const ws = await connectWs();
    console.log('WebSocket connected');

    // Wait for PTY to be ready
    await new Promise(r => setTimeout(r, 1000));

    // Run benchmarks
    console.log('\nRunning benchmarks...');

    results.push(await benchSingleCharEcho(ws));
    printResult(results[results.length - 1]);

    results.push(await benchCommandExec(ws));
    printResult(results[results.length - 1]);

    results.push(await benchThroughput(ws));
    printResult(results[results.length - 1]);

    ws.close();

    results.push(await benchSessionsApi());
    printResult(results[results.length - 1]);

    // Save results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = `backend/tests/benchmark/results/${timestamp}.json`;
    const report = {
      timestamp: new Date().toISOString(),
      server: SERVER_URL,
      rounds: ROUNDS,
      results,
    };

    await Bun.write(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nResults saved to: ${reportPath}`);

    // Summary table
    console.log('\n=== Summary ===');
    console.log('Benchmark'.padEnd(45) + 'Mean'.padStart(10) + 'P95'.padStart(10) + 'P99'.padStart(10));
    console.log('-'.repeat(75));
    for (const r of results) {
      console.log(
        r.name.padEnd(45) +
        `${r.mean.toFixed(2)}ms`.padStart(10) +
        `${r.p95.toFixed(2)}ms`.padStart(10) +
        `${r.p99.toFixed(2)}ms`.padStart(10)
      );
    }
  } finally {
    await deleteSession();
  }
}

main().catch(console.error);
