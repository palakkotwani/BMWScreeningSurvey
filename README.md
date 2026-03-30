# BMWScreeningSurvey

**Screen the funnel. Then talk to the people who fit.**

BMWScreeningSurvey is a single Next.js app for a two-part research flow: a **Typeform** questionnaire that classifies respondents (BMW customer, potential BMW customer, or screened out), and for those who qualify, a **browser-based voice interview** powered by **ElevenLabs**. One stable **respondent id** per browser ties the screener, your server-side store, and the voice session together—no separate accounts.

**Example Typeform (replace with your form id in env):** [Typeform](https://form.typeform.com/to/UKQtUuLG)

**Deeper technical design:** [docs/PROJECT_WRITEUP.md](docs/PROJECT_WRITEUP.md)

---

## What you get

- **Part 1 — Screening** — Embedded Typeform with a hidden `respondent_id`, server-side segmentation (age, vehicle ownership, brands), and outcomes: **BMW Customer**, **Potential BMW Customer**, or **screened out**.
- **Part 2 — Voice (qualified only)** — “Start interview” / “Resume interview” opens a realtime conversation with your ElevenLabs agent; transcripts and status are saved so partial sessions can continue later.
- **Session continuity** — Same browser → same respondent id (`localStorage`). Returning visitors who already finished Part 1 skip straight to qualified or screened-out UI; voice progress can resume after disconnect or “save progress.”
- **Ops-friendly** — Webhook ingestion for production; optional **Responses API** ingest for local dev without a public URL. Respondent data lives in a local JSON file for demos (replace with a DB for production).

---

## How to use it (participant flow)

1. Open the app (deployed URL or local dev). The first visit creates a **respondent id** for this browser.
2. Complete the **Typeform** screener. The server stores your segment and whether you qualify.
3. If you **qualify**, start the **voice interview**. Talk with the agent; when it ends the call cleanly, the interview is marked **completed**. If you hang up early or lose connection, progress can be saved as **in progress** so you can **resume** later on the same browser.
4. If you **don’t qualify**, you see a thank-you path; you can retake the screener per your product rules.
5. **Same device, same browser** matters—clearing site data or switching devices starts a new respondent id.

**Testing multiple runs on one machine:** use **Testing tools → New participant ID (reload)** (shown in `npm run dev`; optional `NEXT_PUBLIC_ENABLE_SESSION_TOOLS` in production) to clear the stored id and simulate a fresh respondent.

---

## Tech stack snapshot

| Layer | Choice |
| ----- | ------ |
| **App** | Next.js (App Router), React, TypeScript |
| **Screening** | Typeform embed + webhook and/or post-submit ingest |
| **Rules** | Segmentation in TypeScript ([`lib/segmentation.ts`](lib/segmentation.ts)) |
| **Persistence** | JSON file under `.data/` (see [.data/README.md](.data/README.md); gitignored) |
| **Voice** | ElevenLabs Conversational AI (signed WebSocket URL from server, prompt built in [`lib/alex-system-prompt.ts`](lib/alex-system-prompt.ts)) |

---

## Getting set up

### What you’ll need

- **Node.js 20+**
- **npm**
- A **Typeform** form you control (with hidden field and refs—see below)
- For voice: **ElevenLabs** API key and agent id
- Optional: **Typeform** webhook secret and/or personal access token (see below)

### Install and run (development)

```bash
cd BMWScreeningSurvey
npm install
cp .env.example .env.local
# Edit .env.local — at minimum NEXT_PUBLIC_TYPEFORM_FORM_ID
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** (Next.js default; use another port if 3000 is busy). The dev server reads `.env.local` automatically.

### Environment

1. Copy **[`.env.example`](.env.example)** to **`.env.local`**.
2. Fill in values; keep secrets out of git (`.env.local` is ignored).
3. Summary:

| Variable | Role |
| -------- | ---- |
| `NEXT_PUBLIC_TYPEFORM_FORM_ID` | Typeform form id (required) |
| `TYPEFORM_WEBHOOK_SECRET` | Verify webhook payloads (production / tunneled local) |
| `TYPEFORM_SKIP_SIGNATURE_VERIFY` | `true` only while debugging webhooks |
| `TYPEFORM_ACCESS_TOKEN` | Responses API when webhook cannot reach localhost |
| `TYPEFORM_REF_*` | Optional ref overrides for `age` / `owns_car` / `brands` |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` | Voice (server-only) |
| `NEXT_PUBLIC_ENABLE_SESSION_TOOLS` | Show testing tools on production builds |
| `NEXT_PUBLIC_DEBUG_VOICE_PROMPT` | Log resolved voice prompt in browser console |

### Production build

```bash
npm run build
npm start
```

Run `npm start` only after `npm run build`. Mirror the same env vars on your host. Run **`npm run lint`** before you ship changes.

---

## Typeform configuration (required)

### 1. Hidden field `respondent_id`

In the Typeform builder, add a **Hidden field** named exactly:

`respondent_id`

The embed passes it automatically; the webhook and ingest use it to match submissions to your store.

### 2. Question field refs

The backend maps answers by **field ref** (not title). Set these refs on the corresponding questions:

| Ref | Question (from spec) |
| --- | -------------------- |
| `age` | How old are you? |
| `owns_car` | Do you currently own a car? |
| `brands` | Which car brand do you currently own? (multi) |

If your refs differ, set `TYPEFORM_REF_AGE`, `TYPEFORM_REF_owns_car`, and `TYPEFORM_REF_brands` in `.env.local`.

**Optional fields (e.g. income):** Extra questions can exist for UX; the backend **does not** use them for qualification unless you add code—see [`lib/segmentation.ts`](lib/segmentation.ts).

### 3. Webhook

1. In Typeform, connect a webhook: `POST https://<your-host>/api/webhooks/typeform`
2. Put the webhook **secret** in `TYPEFORM_WEBHOOK_SECRET` in `.env.local`.
3. For local testing with a tunnel, use [ngrok](https://ngrok.com/) (or similar). Use `TYPEFORM_SKIP_SIGNATURE_VERIFY=true` only while debugging.

**Without a tunnel:** Typeform cannot POST to `localhost`. Add **`TYPEFORM_ACCESS_TOKEN`** so after submit the app can pull responses via Typeform’s API (see ingest route).

### 4. Resume without re-answering

The app keeps a **respondent id** in `localStorage` and uses Typeform **save progress** + embed **`keepSession`**. If screening is already complete in `.data/respondents.json`, a return visit skips the embed and shows qualified or screened out.

---

## E2E testing (Typeform + this app)

Screening was tested end-to-end with a **Typeform form** built in the Typeform UI (hidden `respondent_id`, correct refs, webhook or token-based ingest). Set **`NEXT_PUBLIC_TYPEFORM_FORM_ID`** to **your** form id from `form.typeform.com/to/<id>`. The link at the top of this README is an **example** only.

---

## Part 2: Voice (ElevenLabs)

### Credentials

1. In [ElevenLabs](https://elevenlabs.io/), pick a **Conversational AI** agent → **`ELEVENLABS_AGENT_ID`**.
2. Create an **API key** → **`ELEVENLABS_API_KEY`** in `.env.local`.

### Agent behavior

Configure the agent to **end the conversation** when the interview is finished (**`end_call`**) so the app can distinguish a normal completion from a disconnect or partial save.

### System prompt: override (this repo) vs dashboard only

This app sends the **full system prompt from the client** via **`overrides.agent.prompt`** ([`lib/alex-system-prompt.ts`](lib/alex-system-prompt.ts)). That makes it easier to **debug** and to see **exactly what the model receives** each session (including resume context as JSON). In the ElevenLabs agent, enable **client / system prompt override** (wording varies—often under Security or Advanced).

**Alternative:** Keep the full prompt only in the ElevenLabs UI and pass **`dynamicVariables`** only—no override permission, but prompt edits live in the dashboard.

Optional: **`NEXT_PUBLIC_DEBUG_VOICE_PROMPT=true`** logs the resolved prompt in the browser console.

More detail: [docs/PROJECT_WRITEUP.md](docs/PROJECT_WRITEUP.md).

---

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/session` | Register `{ respondentId }` |
| `POST` | `/api/session/reset` | Reset screening; optional `keepVoiceInterview` |
| `POST` | `/api/session/reset-voice` | Clear voice data only (qualified) |
| `GET` | `/api/session/[respondentId]` | Poll qualification / completion |
| `POST` | `/api/session/ingest` | Ingest response by id (needs token) |
| `POST` | `/api/webhooks/typeform` | Typeform webhook |
| `POST` | `/api/voice/signed-url` | Signed WebSocket URL (qualified) |
| `POST` | `/api/voice/register-conversation` | Store ElevenLabs conversation id |
| `POST` | `/api/voice/finalize` | Fetch transcript; `partial` = in progress vs completed |

---

## Data storage

Results and voice fields are stored in **`.data/respondents.json`** on the server (gitignored). See **[`.data/README.md`](.data/README.md)** and [`lib/types.ts`](lib/types.ts). For production, use a real database ([PROJECT_WRITEUP](docs/PROJECT_WRITEUP.md)).

---

## Scripts

| Command | What it does |
| ------- | -------------- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Run production server (after `build`) |
| `npm run lint` | ESLint |

---

## Troubleshooting

- **`missing_brands` with BMW selected:** The brand question’s **block ref** in Typeform should match `brands` (or set `TYPEFORM_REF_brands` in `.env.local`).

## Segmentation rules (code)

Implemented in [`lib/segmentation.ts`](lib/segmentation.ts): under 18 → screen out; no car → screen out; terminate brands (Toyota, Honda, Ford, Tesla, Other) in multi-select → screen out; BMW → **BMW Customer**; Mercedes/Audi (without terminate brands) → **Potential BMW Customer**.

## E2E Demo Videos

bmw_customer: https://drive.google.com/file/d/1lsj_Ny-ZpY97kW2w8ih6FNYPMLoYBLOh/view?usp=sharing

potential_bmw_customer: https://drive.google.com/file/d/1zrhE3x06nEpj7g6k3ovhE3X88_RFiAxo/view?usp=sharing
