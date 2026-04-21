#!/bin/bash
# GovBond — push to GitHub
# Usage: bash scripts/push-to-github.sh https://github.com/YOUR_USERNAME/GovBond.git

REPO_URL=${1:-"https://github.com/xvader/GovBond.git"}

echo "🏛️  GovBond — Preparing GitHub push"
echo ""

# Ensure we're not committing secrets
if grep -r "PRIVATE_KEY=" .env 2>/dev/null | grep -v "your_private_key_here"; then
  echo "❌ .env contains a real PRIVATE_KEY. Aborting."
  exit 1
fi

# Warn about deployment files (they're in .gitignore)
if [ -f "deployments/arbitrum-sepolia.json" ]; then
  echo "⚠️  deployments/arbitrum-sepolia.json exists — it is in .gitignore and will NOT be pushed."
fi

git add -A
git status

echo ""
echo "Ready to commit. Enter commit message (or press Enter for default):"
read -r MSG
MSG=${MSG:-"feat: GovBond v2 — IDRP, BondFactory, admin dashboard, security audit"}

git commit -m "$MSG"
git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL"
git push -u origin main

echo ""
echo "✅ Pushed to $REPO_URL"
echo ""
echo "Next steps:"
echo "  1. Enable GitHub Pages on /frontend folder (for static demo)"
echo "  2. Add contract addresses to README after deployment"
echo "  3. Tag release: git tag v2.0.0 && git push --tags"
