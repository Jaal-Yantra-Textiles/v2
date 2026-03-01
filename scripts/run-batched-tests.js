#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  batchSize: parseInt(process.env.BATCH_SIZE) || 5,
  maxRetries: parseInt(process.env.MAX_RETRIES) || 2,
  parallel: process.env.PARALLEL === 'true',
  parallelCount: parseInt(process.env.PARALLEL_COUNT) || 2,
  filter: process.env.TEST_FILTER || '',
  watch: process.env.WATCH === 'true',
  coverage: process.env.COVERAGE === 'true',
};

// Parse command line arguments
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--batch-size=')) {
    config.batchSize = parseInt(arg.split('=')[1]);
  } else if (arg.startsWith('--filter=')) {
    config.filter = arg.split('=')[1];
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
  --batch-size=N    Number of tests per batch (default: 5)
  --filter=PATTERN  Filter tests by name pattern
  --parallel        Run batches in parallel
  --watch           Watch mode (re-run on changes)
  --coverage        Generate coverage report
  --help            Show this help message

Environment Variables:
  BATCH_SIZE        Same as --batch-size
  TEST_FILTER       Same as --filter
  PARALLEL          Set to 'true' for parallel execution
  PARALLEL_COUNT    Number of parallel batches (default: 2)
  MAX_RETRIES       Max retries for failed tests (default: 2)
  WATCH             Set to 'true' for watch mode
  COVERAGE          Set to 'true' for coverage
`);
    process.exit(0);
  }
});

// Get all test files
const testDir = path.join(__dirname, '../integration-tests/http');
let testFiles = fs.readdirSync(testDir)
  .filter(file => file.endsWith('.spec.ts'))
  .sort();

// Apply filter if provided
if (config.filter) {
  testFiles = testFiles.filter(file => file.includes(config.filter));
}

console.log(`\n🧪 Test Runner Configuration:`);
console.log(`   Files found: ${testFiles.length}`);
console.log(`   Batch size: ${config.batchSize}`);
console.log(`   Parallel: ${config.parallel ? 'Yes' : 'No'}`);
console.log(`   Max retries: ${config.maxRetries}`);
if (config.filter) console.log(`   Filter: ${config.filter}`);

// Statistics
const stats = {
  totalTests: testFiles.length,
  passedBatches: 0,
  failedBatches: 0,
  retriedBatches: 0,
  startTime: Date.now(),
  batchTimes: [],
};

// Run tests in batches to prevent memory issues
let currentBatch = 0;

async function runBatch(batch, batchNumber, retryCount = 0) {
  const batchStartTime = Date.now();
  const totalBatches = Math.ceil(testFiles.length / config.batchSize);
  
  console.log(`\n📦 Batch ${batchNumber}/${totalBatches}${retryCount > 0 ? ` (Retry ${retryCount})` : ''}:`);
  console.log(batch.map(f => `   - ${f}`).join('\n'));
  
  return new Promise((resolve, reject) => {
    const testPattern = batch.map(f => f.replace('.spec.ts', '')).join('|');
    const cmd = 'pnpm';
    const args = [
      'test:integration:http:shared',
      '--testNamePattern',
      `(${testPattern})`
    ];
    
    if (config.coverage) {
      args.push('--coverage');
    }
    
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: '--experimental-vm-modules --max-old-space-size=8192 --expose-gc'
      }
    });
    
    child.on('close', async (code) => {
      const batchTime = Date.now() - batchStartTime;
      stats.batchTimes.push(batchTime);
      
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
          console.log(`❌ Batch ${batchNumber} failed after ${config.maxRetries} retries`);
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
  console.log(`   Total tests:     ${stats.totalTests}`);
  console.log(`   Passed batches:  ${stats.passedBatches} ✅`);
  console.log(`   Failed batches:  ${stats.failedBatches} ❌`);
  console.log(`   Retried batches: ${stats.retriedBatches} 🔄`);
  console.log(`   Total time:      ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`   Avg batch time:  ${(avgBatchTime / 1000).toFixed(2)}s`);
  console.log('='.repeat(60));
  
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
      startTime: Date.now(),
      batchTimes: [],
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
