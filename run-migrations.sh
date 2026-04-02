#!/bin/bash
# Run pending migrations from /app/migrations/
# Each migration runs once. Applied migrations are tracked in a JSON file
# on the data volume so they survive container rebuilds.

MIGRATIONS_DIR="/app/migrations"
TRACKER="/data/.openclaw/migrations-applied.json"

# Initialize tracker if missing
if [ ! -f "$TRACKER" ]; then
    echo '[]' > "$TRACKER"
fi

# Find and run pending migrations in order
for migration in "$MIGRATIONS_DIR"/*.sh; do
    [ -f "$migration" ] || continue
    name=$(basename "$migration")

    # Skip if already applied
    if node -e "
        const applied = JSON.parse(require('fs').readFileSync('$TRACKER', 'utf-8'));
        process.exit(applied.includes('$name') ? 0 : 1);
    " 2>/dev/null; then
        continue
    fi

    echo "[migration] Running: $name"
    bash "$migration"

    # Record as applied
    node -e "
        const fs = require('fs');
        const applied = JSON.parse(fs.readFileSync('$TRACKER', 'utf-8'));
        applied.push('$name');
        fs.writeFileSync('$TRACKER', JSON.stringify(applied, null, 2));
    "
    echo "[migration] Done: $name"
done
