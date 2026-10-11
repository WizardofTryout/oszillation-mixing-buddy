#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Adaptive Modularity & Elastic LOC Governance (2-Zonen-Modell)
# Oszillation Mixing Buddy (Universal AI Co-Producer for DAWs)
#
# Zone 1 (Standard):      <= 3.000 LOC  (Grün, Zielgröße für Module)
# Zone 2 (Elastisch):     3.001 - 4.500 LOC (Gelbe Warnung oder @loc-exemption)
# Zone 3 (Hard Limit):    > 4.500 LOC   (Roter Fehler, Monolithen-Schutz)
# ==============================================================================

WARN_LOC=3000
MAX_LOC=4500

HARD_VIOLATIONS=0
SOFT_WARNINGS=0
EXEMPTIONS_COUNT=0
TOTAL_CHECKED=0

echo "🔍 Scanning codebase using Adaptive Modularity Governance (Soft: ${WARN_LOC}, Hard: ${MAX_LOC})..."

while IFS= read -r -d '' file; do
    TOTAL_CHECKED=$((TOTAL_CHECKED + 1))
    lines=$(wc -l < "$file" | tr -d ' ')

    if [ "$lines" -gt "$MAX_LOC" ]; then
        echo "🚨 [HARD VIOLATION] $file has $lines lines (exceeds absolute ceiling of ${MAX_LOC} LOC!)"
        HARD_VIOLATIONS=$((HARD_VIOLATIONS + 1))
    elif [ "$lines" -gt "$WARN_LOC" ]; then
        # Check first 10 lines for @loc-exemption
        exemption_reason=$(head -n 10 "$file" | grep -i "@loc-exemption" | sed -E 's/.*@loc-exemption:?[[:space:]]*(.*)/\1/' | head -n 1 || true)
        
        if [ -n "$exemption_reason" ]; then
            echo "ℹ️  [ELASTIC CORRIDOR - EXEMPTION] $file ($lines lines): $exemption_reason"
            EXEMPTIONS_COUNT=$((EXEMPTIONS_COUNT + 1))
        else
            echo "⚠️  [SOFT WARNING] $file has $lines lines (exceeds ${WARN_LOC} LOC; modularize or declare @loc-exemption)"
            SOFT_WARNINGS=$((SOFT_WARNINGS + 1))
        fi
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

echo ""
echo "📊 Checked $TOTAL_CHECKED source files."
echo "   • Standard Module (≤ ${WARN_LOC} LOC): $((TOTAL_CHECKED - SOFT_WARNINGS - EXEMPTIONS_COUNT - HARD_VIOLATIONS))"
echo "   • Elastischer Korridor deklariert (@loc-exemption): $EXEMPTIONS_COUNT"
echo "   • Soft Warnings (${WARN_LOC}–${MAX_LOC} LOC ohne Exemption): $SOFT_WARNINGS"
echo "   • Hard Violations (> ${MAX_LOC} LOC): $HARD_VIOLATIONS"

if [ "$HARD_VIOLATIONS" -gt 0 ]; then
    echo "🚨 Error: $HARD_VIOLATIONS file(s) exceeded the absolute hard limit of ${MAX_LOC} LOC!"
    exit 1
else
    echo "✅ Adaptive Modularity & Elastic LOC Governance PASSED."
    exit 0
fi
