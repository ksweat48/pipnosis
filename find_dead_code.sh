#!/bin/bash

# For each service file, check if any OTHER file imports from it
# We exclude the file from importing itself

cd src

for service_file in services/*.ts; do
  # Extract just the filename without path or extension
  basename_full=$(basename "$service_file")
  basename_noext="${basename_full%.ts}"
  
  # Search for imports of this file in OTHER files (exclude itself)
  # Count lines that have "import" and the filename in them
  count=$(grep -r "from.*['\"].*$basename_noext" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    | grep -v "^$service_file:" \
    | wc -l)
  
  if [ $count -eq 0 ]; then
    echo "DEAD CODE: $basename_full (0 imports)"
  fi
done
