#!/bin/bash

cd /tmp/cc-agent/62036480/project/src

target_files=(
  "services/adversarial-detector"
  "services/estimation-risk-calculator"
  "services/historical-data-monitor"
  "services/condition-monitor"
  "services/sentiment-coordinator"
  "services/market-condition-risk-adjuster"
  "services/sentiment-risk-modifiers"
  "services/correlation-risk-manager"
  "services/progressive-risk-scaling"
  "services/counterfactual-engine"
  "services/forecast-engine"
  "brains/omega9-hallucination-brain"
  "brains/omega10-meta-reasoning"
  "services/omega10-scheduler"
  "services/omega9-constraint-provider"
  "services/daily-narrative-builder"
)

echo "CHECKING TARGET FILES FOR IMPORTS:"
echo "=================================="

for file in "${target_files[@]}"; do
  filename=$(basename "$file")
  basename_noext="${filename%.ts}"
  
  # Count imports excluding the file itself
  count=$(grep -r "from.*['\"].*$basename_noext" . --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    | grep -v "^$file\.ts:" \
    | wc -l)
  
  if [ $count -eq 0 ]; then
    echo "DEAD CODE: $file.ts (0 imports)"
  else
    echo "ACTIVE: $file.ts ($count imports)"
  fi
done
