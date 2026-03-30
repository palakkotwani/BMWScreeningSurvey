# Technical design & integration

This document explains how the app actually hangs together—sessions, where Typeform and voice data land, and why we made a few sharp trade-offs. **How to run it and configure env** stays in the root [README.md](../README.md).

---

## Session management (the spine of the app)

Everything keys off a single **respondent id**: a UUID we create once per browser and keep in `localStorage` under `diligence_respondent_id`. That id is what makes “this submission” and “this voice call” the same person without logins.

On load, the client:

1. Reads or creates that id.
2. Calls `**POST /api/session`** so the server registers the id (and creates a row in our store if needed).
3. Calls `**GET /api/session/[respondentId]**` to see whether we already know the outcome of Part 1.

If the stored record says screening is **complete**, we **skip the Typeform embed** and jump straight to the qualified or screened-out screen. If not, we show the embed. So “session” here is really **browser id + server record in sync**: the client doesn’t guess qualification only from memory; it asks the server each time.

**Why that matters:** refreshing the tab or coming back later still works as long as they use the same browser profile and we still have their row in `.data/respondents.json`. There is no server-side session cookie—the **respondent id is the session handle**.

**Limits:** new device or cleared storage → new id → new row. That was acceptable for this study; cross-device would need something stronger than a hidden field.

**Testing:** on the same browser, use **Testing tools → New participant ID (reload)** in [`SurveyFlow`](../components/SurveyFlow.tsx) to clear `localStorage` and reload with a fresh id (shown in dev by default; set `NEXT_PUBLIC_ENABLE_SESSION_TOOLS` for production builds). See the README subsection **Testing: new participant on the same browser**.

---

## Where Typeform state lives and how it gets there

Typeform owns the form UI; we **embed** it and pass `**respondent_id`** as a hidden field so every submission (and webhook payload) carries our id.

When an answer set is ingested—either from the **webhook** (`POST /api/webhooks/typeform`) or, when localhost can’t receive webhooks, from `**POST /api/session/ingest`** after submit—we parse answers, run `[lib/segmentation.ts](../lib/segmentation.ts)`, and **upsert** `[lib/store.ts](../lib/store.ts)`. What we persist for Part 1 includes things like `**segment`** (qualified vs screened out, BMW vs potential), `**typeformResponseToken**`, `**submittedAt**`, and optional `**screenOutReason**`. That’s the **authoritative Typeform outcome** on our side: one JSON file keyed by `respondentId`, shape in `[lib/types.ts](../lib/types.ts)`.

**Why rules live in code:** we didn’t want “who qualifies” duplicated in Typeform logic and TypeScript. The form can change copy; refs stay stable (or we override with `TYPEFORM_REF_*`). If a ref is wrong, segmentation breaks in a quiet way—that’s the main operational footgun.

**Retake:** users can reset screening (`POST /api/session/reset`). We can optionally **keep** voice data on the same id via `**keepVoiceInterview`** so they only redo the questionnaire—see `[resetSurveyKeepVoiceInterview](../lib/store.ts)`.

---

## Voice: interview status, resume, and transcript

Part 2 is ElevenLabs over WebSocket. The API key never hits the browser: we fetch a **signed URL** from our backend, then the React SDK connects.

For each respondent we track, among other fields:

- `**interviewStatus`**: `not_started` | `in_progress` | `completed` | `failed`
- `**interviewTranscript**`: text we’ve pulled from ElevenLabs when we **finalize**
- `**elevenLabsConversationId`**: last conversation id we care about for finalize/refetch

**Finalize** (`POST /api/voice/finalize`) is where transcript text and status get written. We pass `**partial: true`** when the call ended in a “save progress” way (disconnect, user ended early, tab closed—anything except a clean agent hang-up) and `**partial: false**` when we believe the interview **completed** normally. The SDK tells us that distinction mainly via disconnect reason `**agent`** when the model used **end conversation** / `end_call`.

**Why resume matters:** if someone drops mid-interview, we don’t want them to start from zero. The next time they open **Start interview**, we need the model to know it’s a **resume** and ideally what was already said. So:

- `**is_resume`** in the built prompt is tied to **server state** (`interviewStatus === "in_progress"`), not “first WebSocket ever,” so we don’t get a fake “welcome back” on a fresh qualified start.
- `**prior context`** is a **JSON** blob in the system prompt (`transcript`, `truncated`, `version`) built in `[lib/alex-system-prompt.ts](../lib/alex-system-prompt.ts)`. The transcript string is **trimmed** so we don’t blow the context window—long sessions get a cap with a clear marker.

Placeholder or non-renderable transcript edge cases are handled in the UI so we don’t feed garbage into that JSON. It’s not perfect memory—it's a **text snapshot**—but it’s enough for the agent to continue coherently most of the time.

We also fire finalize on `**pagehide`** with `sendBeacon` / `keepalive` as a **best effort** when someone closes the tab; browsers don’t guarantee that.

---

## What I wired up (short map)

- **Browser id:** `localStorage` + hidden Typeform field → same id for webhook and UI.
- **Server record:** `[lib/store.ts](../lib/store.ts)` → `.data/respondents.json` (runtime; see `[.data/README.md](../.data/README.md)`).
- **Screening:** webhook or ingest → `ingestFormResponse` → `segment` + refs from `[lib/segmentation.ts](../lib/segmentation.ts)`.
- **Voice:** `[POST /api/voice/signed-url](../app/api/voice/signed-url/route.ts)` → `[VoiceInterviewSection](../components/VoiceInterviewSection.tsx)` → `**buildAlexSystemPrompt`** + `**overrides.agent.prompt**` → register conversation → finalize on disconnect / unload.

---

## Trade-offs (what I’d flag in a review)

**File-backed store.** Fast to ship and easy to inspect, but it’s not a database: concurrent writes or multiple app instances will hurt you. Production should replace `[lib/store.ts](../lib/store.ts)` with something real.

**No accounts.** The hidden-field + localStorage model is simple and privacy-light, but it’s **device-bound**. That’s a product limitation, not a bug.

**Prompt in the repo (override).** The app sends the full system prompt via **`overrides.agent.prompt`** ([`lib/alex-system-prompt.ts`](../lib/alex-system-prompt.ts)) so the text is versioned and inspectable. That choice was mainly for **debugging and transparency**: you can see what the agent is given per session (and use `NEXT_PUBLIC_DEBUG_VOICE_PROMPT` or the ElevenLabs conversation API to verify). The agent in ElevenLabs must **allow client/system prompt override** in its security settings, or the dashboard copy is what runs instead. The alternative architecture is **dashboard-only prompt** plus **`dynamicVariables`** from the client—no override permission, but prompt edits move to the ElevenLabs UI. Either way, **copy changes in-repo need a deploy** when using overrides; dashboard tools (`end_call`, etc.) must still be correct or completion detection drifts.

**Webhook vs ingest.** Production wants a public URL and a verified webhook. Local dev often relies on a Typeform token and post-submit ingest instead; that’s two paths to keep in mind when debugging “why didn’t my segment update?”

**Resume from text only.** ElevenLabs doesn’t give us a magical continuation buffer—we store **transcript** and pass it back in the prompt. Truncation and timing mean resume is **good enough**, not perfect.

---

## Where to look in the codebase


| Topic                                                  | Location                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Types (`RespondentRecord`, segments, interview status) | `[lib/types.ts](../lib/types.ts)`                                                                                                              |
| Read/write `.data`                                     | `[lib/store.ts](../lib/store.ts)`                                                                                                              |
| Webhook + signature                                    | `[app/api/webhooks/typeform](../app/api/webhooks/typeform/route.ts)`, `[lib/typeform-verify.ts](../lib/typeform-verify.ts)`                    |
| ElevenLabs HTTP                                        | `[lib/elevenlabs.ts](../lib/elevenlabs.ts)`                                                                                                    |
| Alex prompt                                            | `[lib/alex-system-prompt.ts](../lib/alex-system-prompt.ts)`                                                                                    |
| Survey + voice UI                                      | `[components/SurveyFlow.tsx](../components/SurveyFlow.tsx)`, `[components/VoiceInterviewSection.tsx](../components/VoiceInterviewSection.tsx)` |
| HTTP routes                                            | [README API table](../README.md#api)                                                                                                           |


---

## When to revisit

Move off JSON storage, add monitoring around webhooks and finalize, align segmentation rules with research on edge cases (e.g. multi-select brands), and add tests for webhook payloads if the Typeform shape changes often.