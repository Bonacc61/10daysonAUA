#!/bin/bash
# Run ONE ralph story, then stop and show you what changed.
#
# WHY THIS EXISTS
# ralph.sh's loop has no independent check: the agent writes the code, checks its
# own acceptance criteria, and sets passes:true itself. Nine iterations of that
# are not nine verified steps — they are one large diff that self-reported nine
# times, and each iteration inherits the last one's mistakes through
# progress.txt and prd.json.
#
# This inserts the missing gate. One story, then a human looks. It is slower on
# purpose; that is the entire point.
#
#   ./scripts/ralph/step.sh
#
# Then read the diff, and run /code-review in Claude Code before the next step.

set -e
cd "$(git rev-parse --show-toplevel)"

RALPH_DIR="scripts/ralph"
PRD="$RALPH_DIR/prd.json"

before_done=$(jq '[.userStories[] | select(.passes==true)] | length' "$PRD")
total=$(jq '.userStories | length' "$PRD")
next=$(jq -r '[.userStories[] | select(.passes==false)] | sort_by(.priority) | .[0] | "\(.id) — \(.title)"' "$PRD")

if [ "$next" = "null" ]; then
  echo "All $total stories already pass. Nothing to do."
  exit 0
fi

echo "─────────────────────────────────────────────────────────────"
echo " ralph step: $before_done/$total done"
echo " next: $next"
echo "─────────────────────────────────────────────────────────────"
echo

"$RALPH_DIR/ralph.sh" --tool claude 1 || true

echo
echo "─────────────────────────────────────────────────────────────"
after_done=$(jq '[.userStories[] | select(.passes==true)] | length' "$PRD")
branch=$(git rev-parse --abbrev-ref HEAD)
echo " branch:   $branch"
echo " progress: $before_done/$total  ->  $after_done/$total"

if [ "$after_done" -eq "$before_done" ]; then
  echo
  echo " ⚠  No story was marked complete. Read the output above before"
  echo "    stepping again — a silent no-op repeated is how a loop burns"
  echo "    tokens without moving."
fi

echo
echo " what changed on this branch vs main:"
git --no-pager diff main...HEAD --stat | tail -25
echo
echo " local checks:"
npm test 2>&1 | tail -3 | sed 's/^/   /'
npm run build >/dev/null 2>&1 && echo "   build: clean" || echo "   build: FAILING"
echo "─────────────────────────────────────────────────────────────"
echo
echo " Before stepping again:"
echo "   1. Read the diff above. Does it match the story, and only the story?"
echo "   2. Run /code-review in Claude Code."
echo "   3. Read the new entry in $RALPH_DIR/progress.txt — a wrong 'Codebase"
echo "      Pattern' propagates to every later iteration and is harder to spot"
echo "      than a code bug."
echo
echo " Then: ./scripts/ralph/step.sh"
