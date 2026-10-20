---
description: Write HANDOFF.md so you can /clear and continue in a fresh, cheap session
argument-hint: "[focus for the next session]"
---
Write a handoff note so this work can continue in a fresh session without the accumulated context.

Create or overwrite `HANDOFF.md` in the project root with these sections, as short as possible while complete (aim for under 60 lines):

1. **Goal**: the task in one or two sentences.
2. **Done so far**: what is finished and verified (files, commands that pass).
3. **Current state**: what is in progress, uncommitted changes, anything broken right now.
4. **Key decisions**: choices made and why, so they are not re-litigated.
5. **Tried and failed**: approaches that did not work, so they are not retried.
6. **Next steps**: an ordered checklist.
7. **Files in play**: paths with line ranges that matter (no file contents).

Focus for the next session: $ARGUMENTS

Do not paste large code blocks or logs into the note. After writing it, reply with exactly:
"✓ HANDOFF.md written. Run /clear, then say: continue from HANDOFF.md"
