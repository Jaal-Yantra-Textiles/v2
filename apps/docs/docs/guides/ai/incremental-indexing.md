---
title: "Incremental Contextual Index Updates"
sidebar_label: "Incremental Indexing"
sidebar_position: 1
---

# Incremental Contextual Index Updates

**Status**: ✅ Complete and Ready to Use
**Performance**: 75% faster (processes only new/changed files)

## Overview

The incremental indexing system updates the contextual index by only processing files that have changed since the last index generation, rather than re-indexing the entire codebase.

### Performance Comparison

| Approach | Files Processed | Time | API Calls |
|----------|----------------|------|-----------|
| **Full Re-index** | 1,167 files | ~2 hours | ~3,000 calls |
| **Incremental Update** | ~50-300 files | ~15-45 min | ~150-900 calls |
| **Speedup** | 75-95% fewer | **4-8x faster** | 75-95% reduction |

## How It Works

### 1. Change Detection

The system uses **file hashing** to detect changes:

```typescript
// Calculates SHA-256 hash of file content
function calculateFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8")
  return createHash("sha256").update(content).digest("hex")
}
```

### 2. Metadata Storage

Stores metadata about indexed files in `.contextual-index/index-metadata.json`:

```json
{
  "version": "1.0.0",
  "lastUpdated": "2026-01-31T...",
  "totalFiles": 870,
  "totalChunks": 1312,
  "files": {
    "src/modules/designs/service.ts": {
      "path": "src/modules/designs/service.ts",
      "hash": "a3b2c1d4e5f6...",
      "size": 15420,
      "mtime": 1738368000000,
      "chunksCount": 3
    }
  }
}
```

### 3. Incremental Update Process

```
1. Scan codebase → Get current files
2. Compare with metadata → Detect changes
3. Process only:
   - New files (not in metadata)
   - Modified files (hash changed)
4. Keep chunks from unchanged files
5. Merge and save updated index
```

## Usage

### First-Time Setup (One-Time)

If you have an existing contextual index without metadata:

```bash
# Generate metadata from existing index
npx tsx src/scripts/generate-index-metadata.ts
```

**Output**:
```
✅ Metadata generated successfully!
📊 Statistics:
   - Files processed: 870
   - Total chunks: 1312
💾 Saved to: .contextual-index/index-metadata.json
```

### Incremental Updates

#### Dry Run (Preview Changes)

```bash
# See what files would be processed without making changes
npx tsx src/scripts/update-contextual-index.ts --dry-run
```

**Example Output**:
```
🔍 Change Detection:
   - New files:       15
   - Modified files:  3
   - Deleted files:   0
   - Unchanged files: 870

🔍 DRY RUN - Would process:
   - src/modules/new-feature/index.ts
   - src/modules/new-feature/service.ts
   - src/api/admin/designs/[id]/route.ts (modified)
   ...
```

#### Update Index

```bash
# Process new and modified files
npx tsx src/scripts/update-contextual-index.ts
```

**Example Output**:
```
⚡ Processing 18 files...

📦 Batch 1/4
📄 Processing: src/modules/new-feature/index.ts
   Found 2 chunks

...

✅ Update Complete!
📊 Final Statistics:
   - Total files:  888
   - Total chunks: 1348
   - Processed:    18 files
   - Added:        36 new chunks
   - Reused:       1312 existing chunks
```

#### Force Full Re-index

```bash
# Re-index everything (ignores metadata)
npx tsx src/scripts/update-contextual-index.ts --force
```

## When to Update

### Recommended Schedule

| Frequency | When | Command |
|-----------|------|---------|
| **Daily** | After significant development | `update-contextual-index.ts` |
| **Weekly** | Regular maintenance | `update-contextual-index.ts` |
| **On-Demand** | After adding new modules/features | `update-contextual-index.ts` |
| **Monthly** | Full verification | `update-contextual-index.ts --force` |

### Automated Updates (Optional)

#### GitHub Actions

```yaml
# .github/workflows/update-contextual-index.yml
name: Update Contextual Index

on:
  schedule:
    # Run every day at 2 AM
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  update-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: yarn install

      - name: Update contextual index
        run: npx tsx src/scripts/update-contextual-index.ts
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

      - name: Commit and push if changed
        run: |
          git config user.name github-actions
          git config user.email github-actions@github.com
          git add .contextual-index/
          git diff --quiet && git diff --staged --quiet || \
            (git commit -m "chore: update contextual index" && git push)
```

#### Cron Job (Local/Server)

```bash
# Add to crontab: crontab -e
# Run daily at 2 AM
0 2 * * * cd /path/to/project && npx tsx src/scripts/update-contextual-index.ts
```

## File Structure

```
.contextual-index/
├── contextual-index.json      # Main index (chunks + metadata)
└── index-metadata.json        # File metadata for change detection
```

### contextual-index.json (7.8MB)

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-01-31T...",
  "totalFiles": 888,
  "totalChunks": 1348,
  "chunks": [
    {
      "filePath": "src/modules/designs/service.ts",
      "chunkIndex": 0,
      "originalContent": "export class DesignService...",
      "context": "[Module: design | Type: service | Op: CRUD]...",
      "contextualContent": "[Context]\n\n[Code]",
      "metadata": { ... },
      "generatedAt": "2026-01-31T..."
    }
  ]
}
```

### index-metadata.json (200KB)

```json
{
  "version": "1.0.0",
  "lastUpdated": "2026-01-31T...",
  "totalFiles": 888,
  "totalChunks": 1348,
  "files": {
    "src/modules/designs/service.ts": {
      "path": "src/modules/designs/service.ts",
      "hash": "sha256_hash_here",
      "size": 15420,
      "mtime": 1738368000000,
      "chunksCount": 3
    }
  }
}
```

## Change Detection Algorithm

```typescript
function detectChanges(currentFiles, metadata) {
  const newFiles = []
  const modifiedFiles = []
  const unchangedFiles = []

  for (const file of currentFiles) {
    const existingMeta = metadata?.files[file]

    if (!existingMeta) {
      // File doesn't exist in metadata → NEW
      newFiles.push(file)
    } else {
      // Calculate current hash
      const currentHash = calculateFileHash(file)

      if (currentHash !== existingMeta.hash) {
        // Hash changed → MODIFIED
        modifiedFiles.push(file)
      } else {
        // Hash same → UNCHANGED
        unchangedFiles.push(file)
      }
    }
  }

  // Find deleted files
  const deletedFiles = []
  const currentFileSet = new Set(currentFiles)
  for (const file of Object.keys(metadata.files)) {
    if (!currentFileSet.has(file)) {
      deletedFiles.push(file)
    }
  }

  return { newFiles, modifiedFiles, deletedFiles, unchangedFiles }
}
```

## Performance Optimization

### Batching

Processes files in batches to avoid rate limits:

```typescript
const CONFIG = {
  batchSize: 5,              // Files per batch
  delayBetweenCalls: 500,    // 500ms between chunks
  batchCooldownMs: 5000,     // 5s between batches
  rateLimitCooldownMs: 30000,// 30s after rate limit
}
```

### Rate Limit Handling

- Exponential backoff on rate limits
- Automatic retry with increasing delays
- Batch cooldown periods

### Reusing Chunks

```
Total chunks: 1348
├── 1312 reused from unchanged files (97%)
└── 36 newly generated (3%)

Time saved: ~97% of LLM API calls
```

## Troubleshooting

### Issue: "No metadata found"

**Cause**: First time using incremental updates on existing index

**Solution**:
```bash
# Generate metadata from existing index
npx tsx src/scripts/generate-index-metadata.ts
```

### Issue: Too many files detected as "new"

**Cause**: File paths changed (e.g., moved files)

**Solution**:
```bash
# Force full re-index to reset metadata
npx tsx src/scripts/update-contextual-index.ts --force
```

### Issue: Index seems stale

**Verification**:
```bash
# Check what would be updated
npx tsx src/scripts/update-contextual-index.ts --dry-run
```

**Solution**:
```bash
# Update incrementally
npx tsx src/scripts/update-contextual-index.ts

# Or force full re-index if many changes
npx tsx src/scripts/update-contextual-index.ts --force
```

### Issue: Rate limit errors

**Solution**:
- Wait for cooldown period (30s)
- Script automatically handles with exponential backoff
- Consider using paid OpenRouter tier for higher limits

## Best Practices

### 1. Regular Updates

```bash
# Add to your workflow
git pull
yarn dev
npx tsx src/scripts/update-contextual-index.ts --dry-run  # Preview
npx tsx src/scripts/update-contextual-index.ts            # Update if needed
```

### 2. After Major Changes

```bash
# After adding new modules or major refactoring
npx tsx src/scripts/update-contextual-index.ts --force
```

### 3. Pre-Deployment

```bash
# Ensure index is current before deploying
npx tsx src/scripts/update-contextual-index.ts
git add .contextual-index/
git commit -m "chore: update contextual index"
```

### 4. Team Collaboration

```bash
# Add to .gitignore if generated locally (not recommended)
# .contextual-index/

# OR commit to repo for team sharing (recommended)
git add .contextual-index/
git commit -m "chore: update contextual index"
git push
```

## Integration with AI V4 Workflow

The AI V4 workflow **automatically** picks up index updates:

```typescript
// No code changes needed!
const resolver = await getHybridQueryResolver()

// Loads the updated index on first call
// All subsequent queries benefit from updated context
```

### Hot Reload (Optional)

If you want to reload the index without restarting:

```typescript
import { resetHybridQueryResolver } from "@/mastra/services/hybrid-query-resolver"

// Force reload on next query
resetHybridQueryResolver()

// Next call will load fresh index
const resolver = await getHybridQueryResolver()
```

## Scripts Reference

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `generate-contextual-index.ts` | Full index generation | First time, or complete rebuild |
| `generate-index-metadata.ts` | Create metadata from existing index | One-time migration |
| `update-contextual-index.ts` | Incremental update | Regular maintenance |
| `update-contextual-index.ts --dry-run` | Preview changes | Before updating |
| `update-contextual-index.ts --force` | Force full re-index | After major changes |

## Cost Estimation

### Full Index (880 files → 1,312 chunks)

- API Calls: ~3,000 calls
- Time: ~2 hours
- Cost (free tier): $0
- Cost (paid tier): ~$1-2

### Incremental Update (50 new files → 150 chunks)

- API Calls: ~300 calls
- Time: ~15 minutes
- Cost (free tier): $0
- Cost (paid tier): ~$0.10-0.20

**Savings**: 90% cost reduction, 8x faster

## Monitoring

### Check Index Status

```bash
# View index metadata
cat .contextual-index/index-metadata.json | jq '{
  totalFiles,
  totalChunks,
  lastUpdated
}'
```

### Verify Freshness

```bash
# Check for new/modified files
npx tsx src/scripts/update-contextual-index.ts --dry-run
```

### Track Updates Over Time

```bash
# Git history of index updates
git log --oneline .contextual-index/
```

## Summary

The incremental indexing system provides:

- ✅ **75-95% faster updates** (only process changed files)
- ✅ **Automatic change detection** (SHA-256 file hashing)
- ✅ **Zero breaking changes** (backward compatible)
- ✅ **Production ready** (tested and verified)
- ✅ **Easy to use** (single command)

**Recommended workflow**:
```bash
# 1. First time (one-time)
npx tsx src/scripts/generate-index-metadata.ts

# 2. Regular updates (daily/weekly)
npx tsx src/scripts/update-contextual-index.ts

# 3. Major changes (monthly or as needed)
npx tsx src/scripts/update-contextual-index.ts --force
```

---

For more information, see:
- [Contextual Retrieval Status](/docs/implementation/ai/retrieval-status)
- [Implementation Summary](/docs/implementation/ai/contextual-retrieval)
