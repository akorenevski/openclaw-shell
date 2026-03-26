---
description: Perform the task, change, update that user is asking to do
allowed-tools: Task, Read, Grep, Glob, LS, Bash(git status:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git checkout:*), Bash(git pull:*), Bash(git merge:*), Bash(git diff:*), Bash(git log:*)
---

# Task

## Objective
Ultrathink.

Commit current changes and merge to the staging/development branch:

1. Check current branch status
2. If on main/production branch, switch to a feature branch first (ask user which one)
3. Commit all changes and push to current feature branch
4. Ask user which branch to merge into (e.g., "staging", "develop", "dev")
5. Merge feature branch into target branch and push
6. Switch back to the feature branch

Additional info: **$ARGUMENTS**