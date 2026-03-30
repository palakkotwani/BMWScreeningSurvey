"use client";

import { Widget } from "@typeform/embed-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  VoiceInterviewSection,
  type QualifiedVoiceSubphase,
} from "@/components/VoiceInterviewSection";

const STORAGE_KEY = "diligence_respondent_id";

type SessionPayload = {
  segment: string | null;
  surveyComplete: boolean;
  qualified: boolean;
  screenOutReason: string | null;
};

type Phase =
  | "loading"
  | "survey"
  | "syncing"
  | "qualified"
  | "screened_out"
  | "error";

function getOrCreateRespondentId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

const showSessionTools =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_SESSION_TOOLS === "true";

export function SurveyFlow({ formId }: { formId: string }) {
  const [respondentId, setRespondentId] = useState<string>("");
  /** Bump to remount Typeform so respondents can change answers; id in localStorage unchanged. */
  const [embedKey, setEmbedKey] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  /** If true, `POST /api/session/reset` keeps Part 2 data while clearing screening to `pending`. */
  const [keepVoiceOnSurveyRetake, setKeepVoiceOnSurveyRetake] = useState(false);
  /** Drives footer copy on the qualified step (synced from `VoiceInterviewSection`). */
  const [qualifiedVoicePhase, setQualifiedVoicePhase] =
    useState<QualifiedVoiceSubphase>("fresh");

  const handleQualifiedVoicePhase = useCallback(
    (phaseVoice: QualifiedVoiceSubphase) => {
      setQualifiedVoicePhase(phaseVoice);
    },
    []
  );

  useEffect(() => {
    const id = getOrCreateRespondentId();
    setRespondentId(id);

    void (async () => {
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ respondentId: id }),
        });
        if (!res.ok) throw new Error("Could not start session");

        const sessionRes = await fetch(
          `/api/session/${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );
        if (sessionRes.ok) {
          const data = (await sessionRes.json()) as SessionPayload & {
            respondentId: string;
          };
          if (data.surveyComplete) {
            setSession(data);
            setPhase(data.qualified ? "qualified" : "screened_out");
            return;
          }
        }

        setPhase("survey");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Session error");
        setPhase("error");
      }
    })();
  }, []);

  const pollUntilComplete = useCallback(async (id: string) => {
    const maxAttempts = 45;
    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(
        `/api/session/${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const data = (await res.json()) as SessionPayload & {
        respondentId: string;
      };
      if (data.surveyComplete) {
        setSession(data);
        if (data.qualified) setPhase("qualified");
        else setPhase("screened_out");
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    setError(
      "We could not confirm your survey yet. For local dev: add TYPEFORM_ACCESS_TOKEN to .env.local (Typeform personal token), or run ngrok and configure the Typeform webhook to POST to /api/webhooks/typeform. Then restart npm run dev and submit again."
    );
    setPhase("error");
  }, []);

  const retakeSurvey = useCallback(
    async (options?: { keepVoiceInterview?: boolean }) => {
      if (!respondentId) return;
      const keepVoice =
        options?.keepVoiceInterview ?? keepVoiceOnSurveyRetake;
      try {
        const res = await fetch("/api/session/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            respondentId,
            keepVoiceInterview: keepVoice,
          }),
        });
        if (!res.ok) throw new Error("Could not reset session");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reset failed");
        setPhase("error");
        return;
      }
      setSession(null);
      setError(null);
      setKeepVoiceOnSurveyRetake(false);
      setEmbedKey((k) => k + 1);
      setPhase("survey");
    },
    [keepVoiceOnSurveyRetake, respondentId]
  );

  const newParticipantId = useCallback(() => {
    if (
      !window.confirm(
        "Create a new participant ID? This browser will get a fresh ID after reload. Use this for testing a clean respondent."
      )
    ) {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }, []);

  const onSubmit = useCallback(
    ({ responseId }: { responseId: string }) => {
      setPhase("syncing");
      void (async () => {
        try {
          const res = await fetch("/api/session/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ responseId, respondentId }),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            console.warn("[survey] ingest:", res.status, err);
          }
        } catch (e) {
          console.warn("[survey] ingest failed", e);
        }
        await pollUntilComplete(respondentId);
      })();
    },
    [pollUntilComplete, respondentId]
  );

  const hidden = useMemo(
    () => ({ respondent_id: respondentId }),
    [respondentId]
  );

  /** First load uses keepSession for mid-survey return; retakes remount with keepSession off for a cleaner new attempt. */
  const keepSession = embedKey === 0;

  if (phase === "loading" || !respondentId) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white p-8 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-[#1c69d4] border-t-transparent"
          aria-hidden
        />
        <p className="text-sm">Preparing your session…</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        <p className="font-medium">Something went wrong</p>
        <p className="mt-2 text-sm opacity-90">{error}</p>
        <button
          type="button"
          onClick={() => void retakeSurvey()}
          className="mt-4 rounded-lg bg-red-900 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 dark:bg-red-200 dark:text-red-950 dark:hover:bg-white"
        >
          Back to survey
        </button>
      </div>
    );
  }

  if (phase === "syncing") {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-[#1c69d4] border-t-transparent"
          aria-hidden
        />
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          Saving your responses…
        </p>
      </div>
    );
  }

  if (phase === "qualified" && session) {
    const voiceSegment =
      session.segment === "bmw_customer" ||
      session.segment === "potential_bmw_customer"
        ? session.segment
        : null;

    return (
      <div className="rounded-2xl border border-zinc-200/90 bg-[#f0f2f5] p-8 text-zinc-900 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:shadow-none">
        {voiceSegment ? (
          <VoiceInterviewSection
            key={embedKey}
            respondentId={respondentId}
            segment={voiceSegment}
            onQualifiedSubphaseChange={handleQualifiedVoicePhase}
          />
        ) : (
          <p className="text-sm leading-relaxed opacity-90">
            Thanks for completing the survey. We couldn&apos;t load the next
            step—please refresh the page or try again later.
          </p>
        )}
        <div className="mt-6 space-y-3 rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-none">
          {qualifiedVoicePhase === "complete" ? (
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              To change your <span className="font-medium">screening</span>{" "}
              answers, tap <span className="font-medium">Update my answers</span>
              . Use the checkbox if you want to{" "}
              <span className="font-medium">keep</span> your current voice survey
              and transcript when the screening resets; leave it unchecked to{" "}
              <span className="font-medium">clear</span> them. To{" "}
              <span className="font-medium">record a new voice survey</span>{" "}
              without changing the screening, use{" "}
              <span className="font-medium">Redo voice survey</span> in the
              section above.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              Need to fix something in the{" "}
              <span className="font-medium">screening questionnaire</span>? Tap{" "}
              <span className="font-medium">Update my answers</span> below. Check
              the box if you want to{" "}
              <span className="font-medium">keep</span> your in-progress or saved
              voice survey and transcript; leave it unchecked if you&apos;d like
              them cleared when the screening resets.
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-sm leading-snug text-zinc-800 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={keepVoiceOnSurveyRetake}
              onChange={(e) => setKeepVoiceOnSurveyRetake(e.target.checked)}
              className="mt-0.5 rounded border-zinc-400 dark:border-zinc-600"
            />
            <span>
              Keep my voice survey and transcript when resetting only the
              screening questions
            </span>
          </label>
          <button
            type="button"
            onClick={() => void retakeSurvey()}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            Update my answers
          </button>
        </div>
        {showSessionTools ? (
          <div className="mt-4 rounded-lg border border-dashed border-zinc-400/60 bg-zinc-100/50 p-3 text-xs text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900/40 dark:text-zinc-300">
            <p className="font-medium text-zinc-800 dark:text-zinc-200">
              Testing tools
            </p>
            <p className="mt-1 opacity-90">
              Current id:{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-950">
                {respondentId.slice(0, 8)}…
              </code>
            </p>
            <button
              type="button"
              onClick={newParticipantId}
              className="mt-2 rounded border border-zinc-400 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              New participant ID (reload)
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === "screened_out" && session) {
    return (
      <div className="rounded-xl border border-zinc-200/90 bg-white p-8 text-zinc-800 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_24px_rgba(0,0,0,0.06)] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-none">
        <div
          className="mb-4 h-0.5 w-10 rounded-full bg-[#1c69d4]"
          aria-hidden
        />
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          Thank you
        </h2>
        <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
          We appreciate you taking the time to complete this survey. Your
          responses are valuable to our research.
        </p>
        <p className="mt-4 max-w-prose text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
          If your situation changes down the road, you&apos;re welcome to go
          through the questionnaire again. Use{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            this same browser on this device
          </span>{" "}
          so we can keep your session consistent.
        </p>
        <div className="mt-8 rounded-lg border border-zinc-100 bg-zinc-50/90 p-5 dark:border-zinc-700/80 dark:bg-zinc-800/50">
          <button
            type="button"
            onClick={() => void retakeSurvey({ keepVoiceInterview: false })}
            className="rounded-lg bg-[#1c69d4] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1557b0]"
          >
            Take the survey again
          </button>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
            Your answers will be reviewed again when you submit.
          </p>
        </div>
        {showSessionTools ? (
          <div className="mt-6 rounded-lg border border-dashed border-zinc-400/60 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900/40 dark:text-zinc-300">
            <p className="font-medium text-zinc-800 dark:text-zinc-200">
              Testing tools
            </p>
            <button
              type="button"
              onClick={newParticipantId}
              className="mt-2 rounded border border-zinc-400 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              New participant ID (reload)
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 shadow-sm dark:border-zinc-800">
      <Widget
        key={embedKey}
        id={formId}
        style={{
          width: "100%",
          height: "min(960px, max(520px, 85vh))",
        }}
        className="tf-widget"
        hidden={hidden}
        keepSession={keepSession}
        onSubmit={onSubmit}
      />
      </div>
      {showSessionTools ? (
        <div className="rounded-lg border border-dashed border-zinc-400/60 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900/40 dark:text-zinc-300">
          <p className="font-medium text-zinc-800 dark:text-zinc-200">
            Testing tools
          </p>
          <p className="mt-1 opacity-90">
            Participant id:{" "}
            <code className="rounded bg-white px-1 dark:bg-zinc-950">
              {respondentId.slice(0, 8)}…
            </code>
          </p>
          <button
            type="button"
            onClick={newParticipantId}
            className="mt-2 rounded border border-zinc-400 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            New participant ID (reload)
          </button>
        </div>
      ) : null}
    </div>
  );
}
