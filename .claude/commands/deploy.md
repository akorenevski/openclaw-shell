---
description: Merge staging branch into main and push to deploy
allowed-tools: Task, Read, Grep, Glob, LS, Bash(git status:*), Bash(git branch:*), Bash(git push:*), Bash(git checkout:*), Bash(git pull:*), Bash(git merge:*), Bash(git diff:*), Bash(git log:*)
---

# Task

## Objective
Ultrathink.

Deploy to production by merging staging/development branch into main/production:

1. Ask user to confirm source branch (e.g., "staging", "develop") and target branch (e.g., "main", "production")
2. Check current branch, if on target branch switch to source first
3. Ensure source branch is up to date: `git checkout <source> && git pull origin <source>`
4. Switch to target branch: `git checkout <target> && git pull origin <target>`
5. Merge source into target: `git merge <source>`
6. Push target to remote: `git push origin <target>`
7. Switch back to the original branch you started on

If there are merge conflicts, stop and inform the user - do not force resolve.

Additional info: **$ARGUMENTS**
