#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get all test files
const testDir = path.join(__dirname, '../integration-tests/http');
const testFiles = fs.readdirSync(testDir)
  .filter(file => file.endsWith('.spec.ts'))
  .sort();

console.log(`Found ${testFiles.length} test files`);

// Run tests in batches to prevent memory issues
const batchSize = 5;
let currentBatch = 0;

async function runBatch(batch) {
  console.log(`\nRunning batch ${currentBatch + 1}/${Math.ceil(testFiles.length / batchSize)}:`);
  console.log(batch.map(f => `  - ${f}`).join('\n'));
  
  return new Promise((resolve, reject) => {
    const testPattern = batch.map(f => f.replace('.spec.ts', '')).join('|');
    const cmd = 'yarn';
    const args = [
      'test:integration:http:shared',
      '--testNamePattern',
      `(${testPattern})`
    ];
    
    console.log(`Executing: ${cmd} ${args.join(' ')}`);
    
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: '--experimental-vm-modules --max-old-space-size=8192 --expose-gc'
      }
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Batch failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function runAllBatches() {
  try {
    for (let i = 0; i < testFiles.length; i += batchSize) {
      const batch = testFiles.slice(i, i + batchSize);
      await runBatch(batch);
      currentBatch++;
      
      // Force garbage collection between batches if available
      if (global.gc) {
        console.log('Forcing garbage collection...');
        global.gc();
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n✅ All test batches completed successfully!');
  } catch (error) {
    console.error('\n❌ Test run failed:', error.message);
    process.exit(1);
  }
}

runAllBatches();
