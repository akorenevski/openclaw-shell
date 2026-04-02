#!/bin/bash
# Migration 001: Remove deprecated skills from previous versions
# These skills were replaced or removed from the bundled skill set.

deprecated_skills="pages-api public-pages"
for skill_name in $deprecated_skills; do
    if [ -d "/data/workspace/skills/$skill_name" ]; then
        echo "Removing deprecated skill: $skill_name"
        rm -rf "/data/workspace/skills/$skill_name"
    fi
done
