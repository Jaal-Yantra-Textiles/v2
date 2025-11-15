const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  dryRun: process.argv.includes('--dry-run'),
  remove: process.argv.includes('--remove'),
  backup: process.argv.includes('--backup'),
  verbose: process.argv.includes('--verbose'),
  excludePatterns: [],
};

// Parse exclude patterns
process.argv.forEach((arg, index) => {
  if (arg === '--exclude' && process.argv[index + 1]) {
    config.excludePatterns.push(process.argv[index + 1]);
  }
});

// Show help
if (process.argv.includes('--help')) {
  console.log(`
Usage: node add-ts-nocheck.js [OPTIONS] [directory]

Options:
  --dry-run         Show what would be changed without modifying files
  --remove          Remove @ts-nocheck directives instead of adding them
  --backup          Create backup files before modification (.bak)
  --exclude PATTERN Exclude files matching pattern (can be used multiple times)
  --verbose         Show detailed output
  --help            Show this help message

Examples:
  node add-ts-nocheck.js                    # Add to src/mastra
  node add-ts-nocheck.js --dry-run          # Preview changes
  node add-ts-nocheck.js --remove           # Remove directives
  node add-ts-nocheck.js --backup           # Create backups
  node add-ts-nocheck.js --exclude "*.test.ts" # Exclude test files
  node add-ts-nocheck.js src/custom         # Custom directory
`);
  process.exit(0);
}

// Directory to process (default or from argument)
const directoryPath = process.argv.find(arg => !arg.startsWith('--') && arg !== 'node' && !arg.endsWith('.js'))
  || path.resolve(__dirname, '../src/mastra');

// Statistics
const stats = {
  processed: 0,
  modified: 0,
  skipped: 0,
  excluded: 0,
  errors: 0,
};

// Check if file should be excluded
function shouldExclude(filePath) {
  return config.excludePatterns.some(pattern => {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return regex.test(filePath);
  });
}

// Function to recursively process all TypeScript files in a directory
function processDirectory(dirPath) {
  const files = fs.readdirSync(dirPath);
  
  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      // Recursively process subdirectories
      processDirectory(filePath);
    } else if (stats.isFile() && (file.endsWith('.ts') || file.endsWith('.tsx'))) {
      // Check if file should be excluded
      if (shouldExclude(filePath)) {
        if (config.verbose) {
          console.log(`⏭️  Excluded: ${filePath}`);
        }
        stats.excluded++;
        return;
      }
      
      // Process TypeScript files
      if (config.remove) {
        removeTsNoCheck(filePath);
      } else {
        addTsNoCheck(filePath);
      }
    }
  });
}

// Function to add @ts-nocheck to a file if it doesn't already have it
function addTsNoCheck(filePath) {
  try {
    stats.processed++;
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if the file already has the directive
    if (content.includes('// @ts-nocheck')) {
      if (config.verbose) {
        console.log(`⏭️  Already has directive: ${filePath}`);
      }
      stats.skipped++;
      return;
    }
    
    if (config.dryRun) {
      console.log(`✏️  Would add @ts-nocheck to: ${filePath}`);
      stats.modified++;
      return;
    }
    
    // Create backup if requested
    if (config.backup) {
      fs.writeFileSync(filePath + '.bak', content);
      if (config.verbose) {
        console.log(`💾 Created backup: ${filePath}.bak`);
      }
    }
    
    // Add the directive at the top of the file
    content = '// @ts-nocheck - Ignore all TypeScript errors in this file\n' + content;
    fs.writeFileSync(filePath, content);
    console.log(`✅ Added @ts-nocheck to: ${filePath}`);
    stats.modified++;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    stats.errors++;
  }
}

// Function to remove @ts-nocheck from a file
function removeTsNoCheck(filePath) {
  try {
    stats.processed++;
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if the file has the directive
    if (!content.includes('// @ts-nocheck')) {
      if (config.verbose) {
        console.log(`⏭️  No directive found: ${filePath}`);
      }
      stats.skipped++;
      return;
    }
    
    if (config.dryRun) {
      console.log(`✏️  Would remove @ts-nocheck from: ${filePath}`);
      stats.modified++;
      return;
    }
    
    // Create backup if requested
    if (config.backup) {
      fs.writeFileSync(filePath + '.bak', content);
      if (config.verbose) {
        console.log(`💾 Created backup: ${filePath}.bak`);
      }
    }
    
    // Remove the directive line
    content = content.replace(/\/\/ @ts-nocheck.*\n?/g, '');
    fs.writeFileSync(filePath, content);
    console.log(`✅ Removed @ts-nocheck from: ${filePath}`);
    stats.modified++;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    stats.errors++;
  }
}

// Start processing
console.log('\n📝 TypeScript Directive Manager');
console.log('='.repeat(60));
console.log(`Mode:      ${config.remove ? 'Remove' : 'Add'} @ts-nocheck`);
console.log(`Directory: ${directoryPath}`);
console.log(`Dry run:   ${config.dryRun ? 'Yes' : 'No'}`);
console.log(`Backup:    ${config.backup ? 'Yes' : 'No'}`);
if (config.excludePatterns.length > 0) {
  console.log(`Excludes:  ${config.excludePatterns.join(', ')}`);
}
console.log('='.repeat(60) + '\n');

processDirectory(directoryPath);

// Print summary
console.log('\n' + '='.repeat(60));
console.log('📊 Summary');
console.log('='.repeat(60));
console.log(`Processed: ${stats.processed}`);
console.log(`Modified:  ${stats.modified}`);
console.log(`Skipped:   ${stats.skipped}`);
console.log(`Excluded:  ${stats.excluded}`);
console.log(`Errors:    ${stats.errors}`);
console.log('='.repeat(60));

if (config.dryRun) {
  console.log('\n💡 This was a dry run. Use without --dry-run to apply changes.');
}

if (stats.errors > 0) {
  console.log('\n⚠️  Some files had errors. Please review the output above.');
  process.exit(1);
} else {
  console.log('\n✅ Done!');
}
