#!/usr/bin/env node

/**
 * Batched runner for the HTTP integration suite (the main-push release gate).
 *
 * Why batches at all: each jest invocation boots the Medusa app and migrates a
 * fresh database, so the per-invocation cost is large and fixed (~368s on a
 * GitHub runner, measured from run 30374675208). Batching amortises that boot
 * across many spec files. Batches are NOT for isolation — they exist purely so
 * a single long-lived jest process doesn't accumulate enough heap to OOM.
 *
 * Two things this file gets wrong at your peril (both were live bugs, #1187):
 *   1. Spec files must be selected with `--runTestsByPath`. The previous
 *      version joined bare filenames into `--testNamePattern`, which jest
 *      matches against `describe`/`it` STRINGS. Nothing matched, every batch
 *      ran zero tests, jest exited 0, and the gate reported ✅ for months while
 *      asserting nothing.
 *   2. A gate that can report success without proving it ran is the same bug in
 *      a new costume. Every batch is therefore checked against a tripwire: the
 *      number of test suites jest actually executed must equal the number of
 *      files handed to it.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(BACKEND_ROOT, 'integration-tests/http');

// Configuration
const config = {
  // 40 files/invocation. Empirically chosen: boot cost is per invocation, so
  // bigger is cheaper, bounded only by heap growth across a single jest
  // process. See #1188 for the measurements behind this number — re-measure
  // before raising it rather than guessing.
  batchSize: parseInt(process.env.BATCH_SIZE) || 40,
  // Default 0. A retry re-runs the WHOLE batch, so with 40-file batches a
  // single flake used to triple an hour of runner time and mask the flake
  // besides. Opt in per-run when chasing a known-flaky spec.
  maxRetries: parseInt(process.env.MAX_RETRIES) || 0,
  parallel: process.env.PARALLEL === 'true',
  parallelCount: parseInt(process.env.PARALLEL_COUNT) || 2,
  filter: process.env.TEST_FILTER || '',
  watch: process.env.WATCH === 'true',
  coverage: process.env.COVERAGE === 'true',
  // 1-based shard index over SHARD_TOTAL runners. Both must be set together.
  shardIndex: parseInt(process.env.SHARD_INDEX) || 0,
  shardTotal: parseInt(process.env.SHARD_TOTAL) || 0,
  // Set to 'false' to run without the zero-test tripwire (local debugging only
  // — CI must never disable it).
  tripwire: process.env.TRIPWIRE !== 'false',
};

// Parse command line arguments
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--batch-size=')) {
    config.batchSize = parseInt(arg.split('=')[1]);
  } else if (arg.startsWith('--filter=')) {
    config.filter = arg.split('=')[1];
  } else if (arg.startsWith('--shard=')) {
    // --shard=3/8
    const [index, total] = arg.split('=')[1].split('/').map(Number);
    config.shardIndex = index;
    config.shardTotal = total;
  } else if (arg === '--parallel') {
    config.parallel = true;
  } else if (arg === '--watch') {
    config.watch = true;
  } else if (arg === '--coverage') {
    config.coverage = true;
  } else if (arg === '--help') {
    console.log(`
Usage: node run-batched-tests.js [OPTIONS]

Options:
  --batch-size=N    Spec files per jest invocation (default: 40)
  --filter=PATTERN  Only run spec files whose path contains PATTERN
  --shard=I/N       Run shard I of N (1-based); see SHARD_INDEX/SHARD_TOTAL
  --parallel        Run batches in parallel
  --watch           Watch mode (re-run on changes)
  --coverage        Generate coverage report
  --help            Show this help message

Environment Variables:
  BATCH_SIZE        Same as --batch-size
  TEST_FILTER       Same as --filter
  SHARD_INDEX       1-based shard index (requires SHARD_TOTAL)
  SHARD_TOTAL       Number of shards the file list is split across
  PARALLEL          Set to 'true' for parallel execution
  PARALLEL_COUNT    Number of parallel batches (default: 2)
  MAX_RETRIES       Max retries for failed batches (default: 0)
  TRIPWIRE          Set to 'false' to disable the zero-test check (local only)
  WATCH             Set to 'true' for watch mode
  COVERAGE          Set to 'true' for coverage
`);
    process.exit(0);
  }
});

// Get all test files. Recursive: the previous readdirSync() saw only the 224
// files sitting directly in integration-tests/http and silently ignored the 45
// in subdirectories (analytics/, socials/, visual-flows/, store-mcp/,
// fx-rates/, partner-regions/, admin-mcp/, …) — those specs had never run in
// the gate at all. Paths are backend-root-relative so they can be passed
// straight to --runTestsByPath.
function findSpecFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findSpecFiles(full));
    } else if (entry.name.endsWith('.spec.ts')) {
      found.push(path.relative(BACKEND_ROOT, full));
    }
  }
  return found;
}

let testFiles = findSpecFiles(TEST_ROOT).sort();
const discoveredCount = testFiles.length;

// Apply filter if provided
if (config.filter) {
  testFiles = testFiles.filter(file => file.includes(config.filter));
}

// Shard by stride, not by contiguous slice. The list is sorted by path, so
// related (and similarly expensive) specs cluster together — ad-planning-*.ts
// alone is 154 tests sitting adjacent alphabetically. A contiguous slice would
// hand that whole cluster to one runner while another gets a slice of trivial
// specs. Stride assignment (i % total) is just as deterministic and
// reproducible — `--shard=3/8` selects the same files on any machine — but
// spreads the clusters evenly.
if (config.shardTotal > 0) {
  if (config.shardIndex < 1 || config.shardIndex > config.shardTotal) {
    console.error(
      `❌ Invalid shard ${config.shardIndex}/${config.shardTotal} — index must be 1..${config.shardTotal}`
    );
    process.exit(1);
  }
  testFiles = testFiles.filter((_, i) => i % config.shardTotal === config.shardIndex - 1);
}

console.log(`\n🧪 Test Runner Configuration:`);
console.log(`   Files discovered: ${discoveredCount}`);
console.log(`   Files to run:     ${testFiles.length}`);
console.log(`   Batch size:       ${config.batchSize}`);
console.log(`   Parallel:         ${config.parallel ? 'Yes' : 'No'}`);
console.log(`   Max retries:      ${config.maxRetries}`);
console.log(`   Tripwire:         ${config.tripwire ? 'on' : 'OFF'}`);
if (config.shardTotal > 0) console.log(`   Shard:            ${config.shardIndex}/${config.shardTotal}`);
if (config.filter) console.log(`   Filter:           ${config.filter}`);

if (testFiles.length === 0) {
  console.error('\n❌ No spec files selected — refusing to report success on an empty run.');
  process.exit(1);
}

// Statistics
const stats = {
  totalFiles: testFiles.length,
  passedBatches: 0,
  failedBatches: 0,
  retriedBatches: 0,
  testsRun: 0,
  suitesRun: 0,
  startTime: Date.now(),
  batchTimes: [],
  tripwireFailures: [],
};

// Run tests in batches to prevent memory issues
let currentBatch = 0;

/**
 * Read the batch's counts, written by scripts/jest-batch-summary-reporter.js.
 *
 * Deliberately NOT jest's own `--json --outputFile`: that serialises the full
 * result tree, and one failing HTTP spec carries a circular axios req/res pair
 * that makes jest throw "Converting circular structure to JSON" after the run,
 * destroying both the counts and the readable failure output. The custom
 * reporter emits primitives only. Without these counts the only signal is the
 * exit code — precisely the signal that lied for months.
 */
function readJestSummary(resultFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    return {
      numTotalTests: parsed.numTotalTests ?? 0,
      numPassedTests: parsed.numPassedTests ?? 0,
      numFailedTests: parsed.numFailedTests ?? 0,
      numTotalTestSuites: parsed.numTotalTestSuites ?? 0,
    };
  } catch (error) {
    return null;
  }
}

async function runBatch(batch, batchNumber, retryCount = 0) {
  const batchStartTime = Date.now();
  const totalBatches = Math.ceil(testFiles.length / config.batchSize);
  const resultFile = path.join(
    os.tmpdir(),
    `jest-batch-${process.pid}-${batchNumber}-${retryCount}.json`
  );

  console.log(`\n📦 Batch ${batchNumber}/${totalBatches}${retryCount > 0 ? ` (Retry ${retryCount})` : ''}:`);
  console.log(batch.map(f => `   - ${f}`).join('\n'));

  return new Promise((resolve, reject) => {
    const cmd = 'pnpm';
    // No `--` separator: pnpm forwards trailing args to the script verbatim,
    // and jest/yargs treats everything after a literal `--` as a positional
    // testPathPattern. With the separator, these flags silently degrade into
    // regex patterns instead of flags — the batch still runs, but by accident.
    const args = [
      'test:integration:http:shared',
      '--reporters=default',
      `--reporters=${path.join(__dirname, 'jest-batch-summary-reporter.js')}`,
      '--runTestsByPath',
      ...batch,
    ];

    if (config.coverage) {
      args.push('--coverage');
    }

    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        JEST_BATCH_SUMMARY_FILE: resultFile,
        NODE_OPTIONS: '--experimental-vm-modules --max-old-space-size=8192 --expose-gc'
      }
    });

    child.on('close', async (code) => {
      const batchTime = Date.now() - batchStartTime;
      stats.batchTimes.push(batchTime);

      const summary = readJestSummary(resultFile);
      fs.rmSync(resultFile, { force: true });

      if (summary) {
        stats.testsRun += summary.numTotalTests;
        stats.suitesRun += summary.numTotalTestSuites;
        console.log(
          `   ↳ ${summary.numTotalTests} tests across ${summary.numTotalTestSuites}/${batch.length} suites ` +
          `(${summary.numPassedTests} passed, ${summary.numFailedTests} failed)`
        );
      }

      // Tripwire — every file handed in must have produced a suite result, and
      // the batch must have executed at least one test. A batch that "passes"
      // while running nothing is a gate failure, not a pass.
      if (config.tripwire && code === 0) {
        const problem = !summary
          ? 'jest produced no JSON summary'
          : summary.numTotalTestSuites !== batch.length
            ? `only ${summary.numTotalTestSuites} of ${batch.length} suites executed`
            : summary.numTotalTests === 0
              ? 'zero tests executed'
              : null;

        if (problem) {
          console.log(`🚨 Batch ${batchNumber} tripwire: ${problem}`);
          stats.tripwireFailures.push(`Batch ${batchNumber}: ${problem}`);
          stats.failedBatches++;
          reject(new Error(`Batch ${batchNumber} tripwire: ${problem}`));
          return;
        }
      }

      if (code === 0) {
        console.log(`✅ Batch ${batchNumber} passed in ${(batchTime / 1000).toFixed(2)}s`);
        stats.passedBatches++;
        resolve();
      } else {
        if (retryCount < config.maxRetries) {
          console.log(`⚠️  Batch ${batchNumber} failed, retrying... (${retryCount + 1}/${config.maxRetries})`);
          stats.retriedBatches++;

          // Wait a bit before retrying
          await new Promise(r => setTimeout(r, 2000));

          try {
            await runBatch(batch, batchNumber, retryCount + 1);
            resolve();
          } catch (error) {
            reject(error);
          }
        } else {
          console.log(`❌ Batch ${batchNumber} failed${config.maxRetries > 0 ? ` after ${config.maxRetries} retries` : ''}`);
          stats.failedBatches++;
          reject(new Error(`Batch ${batchNumber} failed with exit code ${code}`));
        }
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function runAllBatches() {
  try {
    const batches = [];
    for (let i = 0; i < testFiles.length; i += config.batchSize) {
      batches.push({
        files: testFiles.slice(i, i + config.batchSize),
        number: Math.floor(i / config.batchSize) + 1,
      });
    }

    if (config.parallel) {
      // Run batches in parallel (limited concurrency)
      console.log(`\n🚀 Running ${batches.length} batches in parallel (max ${config.parallelCount} at a time)...`);

      for (let i = 0; i < batches.length; i += config.parallelCount) {
        const parallelBatches = batches.slice(i, i + config.parallelCount);
        await Promise.all(
          parallelBatches.map(batch => runBatch(batch.files, batch.number))
        );

        // Force garbage collection between parallel groups
        if (global.gc) {
          console.log('🗑️  Forcing garbage collection...');
          global.gc();
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } else {
      // Run batches sequentially
      for (const batch of batches) {
        await runBatch(batch.files, batch.number);
        currentBatch++;

        // Force garbage collection between batches if available
        if (global.gc) {
          console.log('🗑️  Forcing garbage collection...');
          global.gc();
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Print summary
    printSummary();

    if (stats.failedBatches > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Test run failed:', error.message);
    printSummary();
    process.exit(1);
  }
}

function printSummary() {
  const totalTime = Date.now() - stats.startTime;
  const avgBatchTime = stats.batchTimes.length > 0
    ? stats.batchTimes.reduce((a, b) => a + b, 0) / stats.batchTimes.length
    : 0;

  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Run Summary');
  console.log('='.repeat(60));
  console.log(`   Spec files:      ${stats.totalFiles}`);
  console.log(`   Suites executed: ${stats.suitesRun}`);
  console.log(`   Tests executed:  ${stats.testsRun}`);
  console.log(`   Passed batches:  ${stats.passedBatches} ✅`);
  console.log(`   Failed batches:  ${stats.failedBatches} ❌`);
  console.log(`   Retried batches: ${stats.retriedBatches} 🔄`);
  console.log(`   Total time:      ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`   Avg batch time:  ${(avgBatchTime / 1000).toFixed(2)}s`);
  console.log('='.repeat(60));

  if (stats.tripwireFailures.length > 0) {
    console.log('\n🚨 Tripwire failures (the gate ran fewer tests than it was given):');
    stats.tripwireFailures.forEach(f => console.log(`   - ${f}`));
  }

  if (stats.failedBatches === 0) {
    console.log('\n✅ All test batches completed successfully! 🎉');
  } else {
    console.log(`\n❌ ${stats.failedBatches} batch(es) failed`);
  }
}

// Watch mode
if (config.watch) {
  console.log('\n👀 Watch mode enabled. Watching for changes...');
  const chokidar = require('chokidar');

  const watcher = chokidar.watch(['src/**/*.ts', 'integration-tests/**/*.ts'], {
    ignored: /node_modules/,
    persistent: true,
  });

  let running = false;

  watcher.on('change', async (path) => {
    if (running) return;

    console.log(`\n📝 File changed: ${path}`);
    console.log('🔄 Re-running tests...\n');

    running = true;
    // Reset stats
    Object.assign(stats, {
      passedBatches: 0,
      failedBatches: 0,
      retriedBatches: 0,
      testsRun: 0,
      suitesRun: 0,
      startTime: Date.now(),
      batchTimes: [],
      tripwireFailures: [],
    });

    await runAllBatches();
    running = false;
  });

  // Initial run
  runAllBatches().then(() => {
    console.log('\n👀 Watching for changes... (Press Ctrl+C to exit)');
  });
} else {
  runAllBatches();
}
