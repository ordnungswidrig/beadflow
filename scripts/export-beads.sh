#!/bin/bash
bd export | python3 -c "
import sys, json
issues = [json.loads(l) for l in sys.stdin if l.strip()]
print(json.dumps(issues, indent=2))
" > public/beads.json
echo "Exported $(cat public/beads.json | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))') issues"
