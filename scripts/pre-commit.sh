#!/usr/bin/env bash
# Layer 1 guard: runs on every commit. Blocks the commit on any failure.
# Install: ln -sf ../../scripts/pre-commit.sh .git/hooks/pre-commit
set -uo pipefail

fail=0
red() { printf '\033[31m%s\033[0m\n' "$1"; }

staged=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$staged" ] && exit 0

# 1. Private files must never be staged.
private_re='(^|/)(PLANNING\.md|CLAUDE\.md|REVIEW\.md)$|(^|/)\.planning/|(^|/)\.env($|\.)|(^|/)data/raw/|(^|/)lidar/|\.(tif|tiff|laz|las)$'
bad=$(echo "$staged" | grep -E "$private_re" | grep -vE '(^|/)\.env\.example$')
if [ -n "$bad" ]; then
  red "BLOCKED: private files staged:"; echo "$bad"; fail=1
fi

# 2. Secrets scan (gitleaks) on staged changes.
if command -v gitleaks >/dev/null 2>&1; then
  if ! gitleaks git --staged --no-banner --redact -v >/dev/null 2>&1; then
    red "BLOCKED: gitleaks found a possible secret. Run: gitleaks git --staged --redact -v"; fail=1
  fi
else
  red "BLOCKED: gitleaks not installed (brew install gitleaks)"; fail=1
fi

# Only scan added lines of text files (skip this script itself).
added=$(git diff --cached -U0 --no-color -- . ':(exclude)scripts/pre-commit.sh' | grep -E '^\+[^+]' || true)

# 3. Hardcoded-key patterns.
key_re='(sk-ant-[A-Za-z0-9_-]{10,}|sk_(live|test)_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|(api[_-]?key|secret|token|password)["'"'"' ]*[:=] *["'"'"'][A-Za-z0-9_\-]{16,}["'"'"'])'
hits=$(echo "$added" | grep -EiI "$key_re" || true)
if [ -n "$hits" ]; then
  red "BLOCKED: string that looks like a key:"; echo "$hits" | cut -c1-120; fail=1
fi

# 4. NEXT_PUBLIC_ must never hold a secret.
pub=$(echo "$added" | grep -E 'NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|ANTHROPIC|RENTCAST|HUD|CENSUS|FRED|PRIVATE|TOKEN)' || true)
if [ -n "$pub" ]; then
  red "BLOCKED: NEXT_PUBLIC_ variable looks like a secret:"; echo "$pub"; fail=1
fi

# 5. PII: owner / defendant / plaintiff name fields from assessment, foreclosure, sheriff data.
pii_re='\b(OWNER_?NAME|OWNERNAME|PROPERTYOWNER|OWNER1|OWNER2|DEFENDANT[A-Z_]*|PLAINTIFF[A-Z_]*|CHANGENOTICEADDRESS[0-9]?|MAILINGADDRESS|owner_name|defendant|plaintiff)\b'
pii=$(echo "$added" | grep -EiI "$pii_re" || true)
if [ -n "$pii" ]; then
  red "BLOCKED: possible PII field (owner/defendant names). Strip it or allowlist deliberately:"
  echo "$pii" | cut -c1-120; fail=1
fi

[ $fail -eq 0 ] && printf '\033[32m%s\033[0m\n' "Layer 1 guard: clean"
exit $fail
