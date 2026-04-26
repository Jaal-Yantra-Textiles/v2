#!/usr/bin/env node

/**
 * Build script for analytics.js
 *
 * Minifies the client-side analytics tracking script with Terser.
 * Version in the preamble is read from this package's package.json
 * so the CDN comment matches the deployed version.
 */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const PACKAGE_JSON = path.join(__dirname, '../package.json');
const INPUT_FILE = path.join(__dirname, '../src/analytics.js');
const OUTPUT_FILE = path.join(__dirname, '../dist/analytics.min.js');

const { version } = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));

async function buildAnalytics() {
  console.log('🔨 Building analytics.min.js for production...\n');

  try {
    // Check if source file exists
    if (!fs.existsSync(INPUT_FILE)) {
      throw new Error(`Source file not found: ${INPUT_FILE}`);
    }

    // Read source file
    const sourceCode = fs.readFileSync(INPUT_FILE, 'utf8');
    console.log(`📖 Read ${path.relative(process.cwd(), INPUT_FILE)}`);
    console.log(`   Size: ${(sourceCode.length / 1024).toFixed(2)} KB\n`);

    // Minify with Terser
    console.log('⚙️  Minifying with Terser...');
    const result = await minify(sourceCode, {
      compress: {
        dead_code: true,
        drop_console: false, // Keep console for debugging
        drop_debugger: true,
        keep_classnames: false,
        keep_fargs: true,
        keep_fnames: false,
        keep_infinity: false,
        passes: 2, // Multiple passes for better compression
      },
      mangle: {
        toplevel: true,
        reserved: ['jytAnalytics'], // Don't mangle global API
      },
      format: {
        comments: false, // Remove all comments
        preamble: `/* JYT Analytics v${version} | Privacy-focused tracking | https://jaalyantra.in */`,
      },
    });

    if (result.error) {
      throw result.error;
    }

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write minified file
    fs.writeFileSync(OUTPUT_FILE, result.code, 'utf8');
    console.log(`\n✅ Wrote ${path.relative(process.cwd(), OUTPUT_FILE)}`);
    console.log(`   Size: ${(result.code.length / 1024).toFixed(2)} KB`);
    
    // Calculate compression ratio
    const ratio = ((1 - result.code.length / sourceCode.length) * 100).toFixed(1);
    console.log(`   Compression: ${ratio}% smaller\n`);

    // Show gzipped size estimate
    const gzipSize = Math.ceil(result.code.length / 3); // Rough estimate
    console.log(`📦 Estimated gzipped size: ~${(gzipSize / 1024).toFixed(2)} KB\n`);

    console.log('✨ Build complete!\n');
    console.log('📋 Next steps:');
    console.log('   1. Test analytics.min.js locally');
    console.log('   2. Deploy to CDN or static hosting');
    console.log('   3. Update tracking script src in client websites\n');
    console.log('💡 Deployment:');
    console.log('   <script src="/analytics.min.js" data-website-id="YOUR_ID" defer></script>\n');

  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

// Run build
buildAnalytics();
