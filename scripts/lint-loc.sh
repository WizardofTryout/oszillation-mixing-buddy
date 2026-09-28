#!/usr/bin/env bash
set -euo pipefail

# Maximum allowable lines of code per single source file
MAX_LOC=3000
VIOLATIONS=0
TOTAL_CHECKED=0

echo "🔍 Scanning codebase for files exceeding ${MAX_LOC} LOC..."

# Search source files, excluding node_modules, build artifacts, git, and third-party deps
while IFS= read -r -d '' file; do
    TOTAL_CHECKED=$((TOTAL_CHECKED + 1))
    lines=$(wc -l < "$file" | tr -d ' ')
    if [ "$lines" -gt "$MAX_LOC" ]; then
        echo "❌ [VIOLATION] $file has $lines lines (exceeds ${MAX_LOC} LOC limit)"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done < <(find . -type f \( \
    -name "*.ts" -o \
    -name "*.tsx" -o \
    -name "*.rs" -o \
    -name "*.cpp" -o \
    -name "*.h" -o \
    -name "*.hpp" -o \
    -name "*.js" -o \
    -name "*.jsx" \
\) \
! -path "*/node_modules/*" \
! -path "*/build/*" \
! -path "*/dist/*" \
! -path "*/target/*" \
! -path "*/.git/*" \
! -path "*/old-research/*" \
-print0)

echo "📊 Checked $TOTAL_CHECKED source files."

if [ "$VIOLATIONS" -gt 0 ]; then
    echo "🚨 Error: $VIOLATIONS file(s) exceeded the ${MAX_LOC} LOC limit!"
    exit 1
else
    echo "✅ All source files adhere to the <= ${MAX_LOC} LOC modularity constraint."
    exit 0
fi
