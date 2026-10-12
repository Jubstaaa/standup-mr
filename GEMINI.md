# standup-mr

When the user asks for their standup, daily note, or what they did yesterday:

1. Call `get_note_instructions` once and follow its rules for writing the note.
2. Call `get_standup_data`. If several accounts are linked and the user didn't
   say which, ask — the tool lists them.
3. Write the note in the user's language. Only call `post_standup_note` when
   the user asks to send it.

If a tool says the login expired, tell the user to run `/mcp auth standup`.
