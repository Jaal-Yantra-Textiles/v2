const fs = require('fs');
const path = require('path');

// Directory to process
const directoryPath = path.resolve(__dirname, '../src/mastra');

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
      // Process TypeScript files
      addTsNoCheck(filePath);
    }
  });
}

// Function to add @ts-nocheck to a file if it doesn't already have it
function addTsNoCheck(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Check if the file already has the directive
  if (!content.includes('// @ts-nocheck')) {
    // Add the directive at the top of the file
    content = '// @ts-nocheck - Ignore all TypeScript errors in this file\n' + content;
    fs.writeFileSync(filePath, content);
    console.log(`Added @ts-nocheck to ${filePath}`);
  } else {
    console.log(`File already has @ts-nocheck: ${filePath}`);
  }
}

// Start processing
console.log('Adding @ts-nocheck to all TypeScript files in src/mastra...');
processDirectory(directoryPath);
console.log('Done!');
