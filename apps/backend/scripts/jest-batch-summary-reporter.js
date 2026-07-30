/**
 * Minimal jest reporter that writes per-batch counts to a file.
 *
 * Exists because `--json --outputFile` cannot be used on this suite: jest's
 * JSON reporter serialises the whole result tree, and a failing HTTP spec
 * carries an axios error whose `req`/`res` reference each other — jest dies
 * with "Converting circular structure to JSON" *after* the tests have run,
 * turning a normal red batch into an unreadable crash and losing the counts.
 *
 * This reporter emits primitives only, so it cannot hit that. It is the input
 * to the zero-test tripwire in run-batched-tests.js (#1187): the gate must
 * prove it executed every file it was handed, not merely exit 0.
 */

const fs = require('fs');

class JestBatchSummaryReporter {
  constructor(globalConfig, options = {}) {
    this._outputFile = options.outputFile || process.env.JEST_BATCH_SUMMARY_FILE;
  }

  onRunComplete(_contexts, results) {
    if (!this._outputFile) {
      return;
    }

    const summary = {
      numTotalTests: results.numTotalTests,
      numPassedTests: results.numPassedTests,
      numFailedTests: results.numFailedTests,
      numPendingTests: results.numPendingTests,
      numTotalTestSuites: results.testResults.length,
      numFailedTestSuites: results.numFailedTestSuites,
      // Relative-ish paths so a failing shard is easy to re-run locally.
      suites: results.testResults.map((r) => ({
        path: r.testFilePath,
        tests: r.testResults.length,
        failed: r.numFailingTests,
      })),
    };

    try {
      fs.writeFileSync(this._outputFile, JSON.stringify(summary));
    } catch (error) {
      // Never let reporting failure mask the test result — the tripwire will
      // treat a missing summary as a failure anyway, which is the safe default.
      console.error(`[jest-batch-summary-reporter] could not write summary: ${error.message}`);
    }
  }
}

module.exports = JestBatchSummaryReporter;
