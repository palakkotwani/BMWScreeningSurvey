# Local data directory

This folder is used **only on the machine running the app** (your laptop, a single server, etc.). It is **not** a shared database.

## `respondents.json`

- **Created automatically** when the first session is registered. The app reads/writes it via [`lib/store.ts`](../lib/store.ts).
- **Gitignored** — the actual file is **not** pushed to GitHub, so respondent ids, transcripts, and tokens stay off the remote by default.
- **Shape:** one JSON object keyed by `respondentId`; each value matches [`RespondentRecord`](../lib/types.ts) (screening segment, Typeform token, timestamps, optional ElevenLabs **`interviewTranscript`**, **`interviewStatus`**, **`elevenLabsConversationId`**, etc.).

For production you would replace this file store with a real database; see [docs/PROJECT_WRITEUP.md](../docs/PROJECT_WRITEUP.md).

**Do not** copy real `respondents.json` contents into issues or commits.
