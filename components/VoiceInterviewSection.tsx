"use client";

import type { DisconnectionDetails } from "@elevenlabs/client";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildAlexSystemPrompt } from "@/lib/alex-system-prompt";
import { PLACEHOLDER_TRANSCRIPT } from "@/lib/placeholder-transcript";

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** ElevenLabs dynamic variables size limit — trim transcript for agent context. */
const MAX_RESUME_TRANSCRIPT_CHARS = 12_000;

function truncateForResume(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_RESUME_TRANSCRIPT_CHARS) {
    return { text, truncated: false };
  }
  return {
    text:
      text.slice(0, MAX_RESUME_TRANSCRIPT_CHARS) +
      "\n\n[...truncated for agent context]",
    truncated: true,
  };
}

type QualifiedSegment = "bmw_customer" | "potential_bmw_customer";

/** Syncs SurveyFlow footer copy with voice UI state. */
export type QualifiedVoiceSubphase = "fresh" | "resume" | "complete";

export type VoiceInterviewSectionProps = {
  respondentId: string;
  segment: QualifiedSegment;
  onQualifiedSubphaseChange?: (subphase: QualifiedVoiceSubphase) => void;
};

type VoiceInterviewInnerProps = VoiceInterviewSectionProps & {
  /** Bump parent key to remount ElevenLabs provider after server clears voice data. */
  onRedoVoiceInterview: () => void;
};

/** ElevenLabs may still be writing the conversation record. */
const FINALIZE_DELAY_MS = 1600;

/**
 * `ConversationProvider` silently skips `startSession` if a prior session or
 * connect lock still exists. `endSession()` clears the ref; a short delay lets
 * an in-flight lock from the last teardown finish so Resume / Start reliably runs.
 */
const VOICE_SDK_RESESSION_GAP_MS = 220;

function isRenderableTranscript(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  return text.trim() !== PLACEHOLDER_TRANSCRIPT;
}

/** Show transcript panel including ElevenLabs “still processing” placeholder copy. */
function hasTranscriptTextToShow(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  return isRenderableTranscript(text) || text.trim() === PLACEHOLDER_TRANSCRIPT;
}

function statusLabel(status: string): string {
  switch (status) {
    case "disconnected":
      return "Not connected";
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Live — speak when prompted";
    case "error":
      return "Connection error";
    default:
      return status;
  }
}

/** Connection / completion chip colors (distinct from plain “not connected”). */
function statusPillClass(status: string, interviewFinished: boolean): string {
  if (interviewFinished) {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-100";
  }
  switch (status) {
    case "connected":
      return "bg-green-100 text-green-900 dark:bg-green-950/70 dark:text-green-100";
    case "connecting":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100";
    case "error":
      return "bg-red-100 text-red-900 dark:bg-red-950/70 dark:text-red-100";
    case "disconnected":
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
  }
}

function VoiceInterviewInner({
  respondentId,
  segment,
  onRedoVoiceInterview,
  onQualifiedSubphaseChange,
}: VoiceInterviewInnerProps) {
  const { startSession, endSession, status, message, isMuted, setMuted } =
    useConversation();
  const [busy, setBusy] = useState(false);
  const [redoBusy, setRedoBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptSavedAt, setTranscriptSavedAt] = useState<string | null>(
    null
  );
  /** Server `interviewStatus === "completed"` — hide start/resume. */
  const [interviewFinished, setInterviewFinished] = useState(false);
  /** Partial save exists — offer resume + pass `is_resume` to the agent. */
  const [canResume, setCanResume] = useState(false);
  /** True while `/api/voice/finalize` is in flight (after optional pre-delay). */
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const respondentIdRef = useRef(respondentId);
  const conversationIdRef = useRef<string | null>(null);
  const sessionConnectedRef = useRef(false);
  /** One finalize (disconnect, unload, or in-flight) per voice session. */
  const sessionFinalizeLockRef = useRef(false);
  const interviewCompletedRef = useRef(false);

  respondentIdRef.current = respondentId;
  useEffect(() => {
    interviewCompletedRef.current = interviewFinished;
  }, [interviewFinished]);

  useEffect(() => {
    const subphase: QualifiedVoiceSubphase = interviewFinished
      ? "complete"
      : canResume
        ? "resume"
        : "fresh";
    onQualifiedSubphaseChange?.(subphase);
  }, [interviewFinished, canResume, onQualifiedSubphaseChange]);

  const applyFinalizeResponse = useCallback(
    (data: {
      skipped?: boolean;
      interviewStatus?: string;
      transcript?: string;
      interviewCompletedAt?: string | null;
      warning?: string;
      partial?: boolean;
    }) => {
      const completed = data.interviewStatus === "completed";
      if (completed) {
        setInterviewFinished(true);
        setCanResume(false);
      } else {
        setInterviewFinished(false);
        setCanResume(true);
      }

      setSavedOk(true);

      const t = typeof data.transcript === "string" ? data.transcript : null;
      const renderable = isRenderableTranscript(t);

      if (renderable && t) {
        setTranscript(t);
        setTranscriptSavedAt(data.interviewCompletedAt ?? null);
        if (data.warning === "short_transcript") {
          setInfo(
            completed
              ? "Saved, but the transcript looks short — wait a few seconds, then tap “Show latest transcript” to reload it from ElevenLabs."
              : "Progress saved, but the transcript looks short — wait a few seconds, then tap “Show latest transcript” to reload it."
          );
        } else {
          setInfo(null);
        }
      } else if (t !== null && t !== undefined && !renderable) {
        if (t.trim() === PLACEHOLDER_TRANSCRIPT) {
          /** Keep placeholder in state so the panel isn’t blank while EL finishes. */
          setTranscript(t);
          setTranscriptSavedAt(data.interviewCompletedAt ?? null);
          setInfo(
            "ElevenLabs is still preparing your transcript. Wait a few seconds, then tap “Show latest transcript”."
          );
        } else {
          setTranscript(null);
          setTranscriptSavedAt(null);
          setInfo(
            "ElevenLabs is still preparing your transcript. Wait a few seconds, then tap “Show latest transcript”."
          );
        }
      }
    },
    []
  );

  const runFinalize = useCallback(
    async (opts: { partial: boolean; leadMs?: number }) => {
      setTranscriptLoading(true);
      setTranscript(null);
      setTranscriptSavedAt(null);
      try {
        if (opts.leadMs !== undefined && opts.leadMs > 0) {
          await new Promise((r) => setTimeout(r, opts.leadMs));
        }
        const res = await fetch("/api/voice/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            respondentId,
            conversationId: conversationIdRef.current ?? undefined,
            partial: opts.partial,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          warning?: string;
          transcript?: string;
          interviewCompletedAt?: string | null;
          interviewStatus?: string;
          skipped?: boolean;
          partial?: boolean;
        };
        if (!res.ok) {
          throw new Error(data.error ?? "Could not save transcript");
        }
        applyFinalizeResponse(data);
      } finally {
        setTranscriptLoading(false);
      }
    },
    [applyFinalizeResponse, respondentId]
  );

  const runFinalizeRef = useRef(runFinalize);
  runFinalizeRef.current = runFinalize;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/session/${encodeURIComponent(respondentId)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          interviewTranscript?: string | null;
          interviewCompletedAt?: string | null;
          interviewStatus?: string | null;
          voiceNeedsSync?: boolean;
        };
        if (data.interviewStatus === "completed") {
          setInterviewFinished(true);
          setCanResume(false);
        } else if (data.interviewStatus === "in_progress") {
          setInterviewFinished(false);
          /** Any in-progress record can resume; transcript may fill in after “Show latest transcript”. */
          setCanResume(true);
        }
        if (
          data.interviewTranscript?.trim() &&
          isRenderableTranscript(data.interviewTranscript)
        ) {
          setTranscript(data.interviewTranscript);
          setTranscriptSavedAt(data.interviewCompletedAt ?? null);
          setSavedOk(true);
        }

        if (data.voiceNeedsSync && !cancelled) {
          setInfo("Loading your transcript…");
          try {
            await runFinalizeRef.current({
              partial: data.interviewStatus !== "completed",
              leadMs: FINALIZE_DELAY_MS,
            });
            if (!cancelled) {
              setInfo(null);
            }
          } catch (e) {
            if (!cancelled) {
              setInfo(null);
              setLocalError(
                e instanceof Error
                  ? e.message
                  : "Could not load transcript — try “Show latest transcript”."
              );
            }
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [respondentId]);

  useEffect(() => {
    const flushPartialOnUnload = () => {
      if (interviewCompletedRef.current) return;
      if (!conversationIdRef.current) return;
      if (sessionFinalizeLockRef.current) return;

      sessionFinalizeLockRef.current = true;
      const payload = JSON.stringify({
        respondentId: respondentIdRef.current,
        conversationId: conversationIdRef.current,
        partial: true,
      });
      const url = `${window.location.origin}/api/voice/finalize`;
      const blob = new Blob([payload], { type: "application/json" });
      const beaconOk =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(url, blob);
      if (!beaconOk) {
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {
          sessionFinalizeLockRef.current = false;
        });
      }
    };

    window.addEventListener("pagehide", flushPartialOnUnload);
    return () => window.removeEventListener("pagehide", flushPartialOnUnload);
  }, []);

  const handleStart = useCallback(async () => {
    setLocalError(null);
    setInfo(null);

    /**
     * Always tear down any lingering SDK session first; otherwise
     * `startSession` is a no-op (see @elevenlabs/react ConversationProvider).
     */
    endSession();
    await new Promise((r) => setTimeout(r, VOICE_SDK_RESESSION_GAP_MS));

    /** Authoritative resume flags (avoids stale React state + fixes false “resume” after register-only). */
    let serverInProgress = canResume;
    let agentTranscript = "";
    try {
      const res = await fetch(
        `/api/session/${encodeURIComponent(respondentId)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          interviewStatus?: string | null;
          interviewTranscript?: string | null;
          interviewCompletedAt?: string | null;
        };
        if (data.interviewStatus === "completed") {
          setInterviewFinished(true);
          setCanResume(false);
          setInfo("This voice interview is already complete.");
          return;
        }
        if (data.interviewStatus === "in_progress") {
          setInterviewFinished(false);
          setCanResume(true);
          serverInProgress = true;
        } else {
          setInterviewFinished(false);
          /**
           * If the API omits `interviewStatus` (null) but the UI already showed
           * Resume, keep resume semantics so `is_resume` / transcript aren’t wiped.
           */
          if (canResume && data.interviewStatus == null) {
            serverInProgress = true;
          } else {
            setCanResume(false);
            serverInProgress = false;
          }
        }
        const t = data.interviewTranscript;
        if (
          typeof t === "string" &&
          t.trim() &&
          isRenderableTranscript(t)
        ) {
          agentTranscript = t.trim();
          setTranscript(t);
          setTranscriptSavedAt(data.interviewCompletedAt ?? null);
          setSavedOk(true);
        }
      }
    } catch {
      /* fall back to client state below */
      if (
        transcript?.trim() &&
        isRenderableTranscript(transcript)
      ) {
        agentTranscript = transcript.trim();
      }
    }

    if (!serverInProgress) {
      setSavedOk(false);
      setTranscript(null);
      setTranscriptSavedAt(null);
      agentTranscript = "";
    }

    conversationIdRef.current = null;
    sessionConnectedRef.current = false;
    sessionFinalizeLockRef.current = false;

    setBusy(true);
    try {
      const res = await fetch("/api/voice/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondentId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        signedUrl?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not start voice session");
      }
      if (!data.signedUrl) {
        throw new Error("Server did not return a voice link");
      }

      const prior = agentTranscript
        ? truncateForResume(agentTranscript)
        : { text: "", truncated: false };
      const alexPrompt = buildAlexSystemPrompt({
        segment,
        isResume: serverInProgress,
        userId: respondentId,
        priorContext: {
          transcript: prior.text,
          truncated: prior.truncated,
        },
      });

      if (process.env.NEXT_PUBLIC_DEBUG_VOICE_PROMPT === "true") {
        console.log("[Alex] resolved system prompt:\n", alexPrompt);
      }

      startSession({
        signedUrl: data.signedUrl,
        connectionType: "websocket",
        userId: respondentId,
        overrides: {
          agent: {
            prompt: {
              prompt: alexPrompt,
            },
          },
        },
        onConnect: async ({ conversationId }) => {
          conversationIdRef.current = conversationId;
          sessionConnectedRef.current = true;
          try {
            await fetch("/api/voice/register-conversation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ respondentId, conversationId }),
            });
          } catch {
            /* persistence best-effort; finalize still sends conversationId */
          }
        },
        onDisconnect: (details: DisconnectionDetails) => {
          if (sessionFinalizeLockRef.current) return;
          // Rely on conversation id, not sessionConnectedRef — the SDK can fire
          // disconnect in edge orders where the "connected" flag is already cleared.
          if (!conversationIdRef.current) return;
          if (interviewCompletedRef.current) return;

          sessionConnectedRef.current = false;
          sessionFinalizeLockRef.current = true;

          const normalAgentEnd = details.reason === "agent";
          setLocalError(null);
          setInfo("Saving your transcript…");
          setBusy(true);
          void (async () => {
            try {
              await runFinalize({
                partial: !normalAgentEnd,
                leadMs: FINALIZE_DELAY_MS,
              });
            } catch (e) {
              sessionFinalizeLockRef.current = false;
              setLocalError(
                e instanceof Error ? e.message : "Could not save transcript"
              );
            } finally {
              setBusy(false);
            }
          })();
        },
      });
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not start");
    } finally {
      setBusy(false);
    }
  }, [
    canResume,
    endSession,
    respondentId,
    segment,
    startSession,
    transcript,
    runFinalize,
  ]);

  /**
   * User ends the call from the UI. Saves as in-progress (partial) so they can
   * resume later (same in-progress state) — same as disconnect mid-call. Only an
   * agent-driven end (end_call) marks the interview completed.
   */
  const handleEndCallAndSave = useCallback(() => {
    if (sessionFinalizeLockRef.current) return;
    if (!conversationIdRef.current) {
      setLocalError("No active conversation to end yet — wait until you are connected.");
      return;
    }
    if (status !== "connected") return;

    sessionFinalizeLockRef.current = true;
    sessionConnectedRef.current = false;
    setLocalError(null);
    setInfo("Saving your progress…");
    setBusy(true);
    endSession();
    void (async () => {
      try {
        await runFinalize({
          partial: true,
          leadMs: FINALIZE_DELAY_MS,
        });
      } catch (e) {
        sessionFinalizeLockRef.current = false;
        setLocalError(
          e instanceof Error ? e.message : "Could not save transcript"
        );
      } finally {
        setBusy(false);
      }
    })();
  }, [endSession, runFinalize, status]);

  const handleRedoVoiceInterview = useCallback(async () => {
    if (
      !window.confirm(
        "Clear your saved voice survey and transcript? Your screening answers stay the same. You can start a new recording afterward."
      )
    ) {
      return;
    }
    setRedoBusy(true);
    setLocalError(null);
    try {
      const res = await fetch("/api/session/reset-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondentId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not reset voice survey");
      }
      onRedoVoiceInterview();
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : "Could not reset voice survey"
      );
    } finally {
      setRedoBusy(false);
    }
  }, [respondentId, onRedoVoiceInterview]);

  const handleRetryFinalize = useCallback(async () => {
    setLocalError(null);
    setInfo(null);
    setBusy(true);
    try {
      /** Don’t mark completed while still in progress — only refresh transcript. */
      await runFinalize({
        partial: !interviewFinished,
        leadMs: FINALIZE_DELAY_MS,
      });
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }, [interviewFinished, runFinalize]);

  const handleDownloadTranscript = useCallback(() => {
    if (!transcript?.trim() || !isRenderableTranscript(transcript)) return;
    const shortId = respondentId.slice(0, 8);
    const date = transcriptSavedAt
      ? new Date(transcriptSavedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    downloadTextFile(`bmw-voice-survey-${date}-${shortId}.txt`, transcript);
  }, [respondentId, transcript, transcriptSavedAt]);

  const canStart =
    !interviewFinished && (status === "disconnected" || status === "error");

  const canRefreshTranscript =
    interviewFinished ||
    savedOk ||
    Boolean(transcript?.trim() && isRenderableTranscript(transcript));

  const showRedoVoice =
    interviewFinished ||
    canResume ||
    savedOk ||
    Boolean(transcript?.trim());

  const startButtonLabel =
    canResume && !interviewFinished
      ? "Resume voice survey"
      : "Start voice survey";

  const introVariant: QualifiedVoiceSubphase = interviewFinished
    ? "complete"
    : canResume
      ? "resume"
      : "fresh";

  const introShell =
    introVariant === "fresh"
      ? "border-l-[#1c69d4] bg-[#eff6ff]/90 dark:border-l-[#1c69d4] dark:bg-zinc-800/60"
      : introVariant === "resume"
        ? "border-l-amber-400 bg-amber-50/40 dark:border-l-amber-500/70 dark:bg-zinc-800/50"
        : "border-l-sky-500 bg-sky-50/50 dark:border-l-sky-400/80 dark:bg-zinc-800/50";

  return (
    <div className="rounded-xl border border-zinc-200/90 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-none">
      <div
        className={`mb-5 rounded-r-lg border-l-4 py-3 pl-4 pr-3 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 ${introShell}`}
      >
        {introVariant === "fresh" ? (
          <>
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">
              Thank you for your time
            </p>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              A short <span className="font-medium">voice survey</span> would
              help us understand your experience in more depth. When your
              browser asks, please{" "}
              <span className="font-medium">allow microphone access</span> so we
              can hear your answers. You can{" "}
              <span className="font-medium">save progress and stop anytime</span>{" "}
              and return later—tap{" "}
              <span className="font-medium">Resume voice survey</span> to pick up
              where you left off. A <span className="font-medium">written transcript</span>{" "}
              will show on this page when it&apos;s ready; if you don&apos;t see
              it right away, tap{" "}
              <span className="font-medium">Show latest transcript</span>.
            </p>
          </>
        ) : introVariant === "resume" ? (
          <>
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">
              Thank you for your help so far
            </p>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Tap <span className="font-medium">Resume voice survey</span> below
              to continue your recording. You can still{" "}
              <span className="font-medium">save progress and step away</span>{" "}
              whenever you need to. Your{" "}
              <span className="font-medium">transcript</span> will stay on this
              page when it&apos;s available.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">
              Thank you—voice survey complete
            </p>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Your <span className="font-medium">transcript</span> is saved
              below (you can download a copy). To{" "}
              <span className="font-medium">record again</span>, use{" "}
              <span className="font-medium">Redo voice survey</span>. To{" "}
              <span className="font-medium">change your screening answers</span>
              —with or without keeping this recording—use{" "}
              <span className="font-medium">Update my answers</span> in the
              section below.
            </p>
          </>
        )}
      </div>

      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        Voice survey
      </h3>
      {introVariant === "complete" ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Review your transcript below when you&apos;re ready.
        </p>
      ) : introVariant === "fresh" ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          When you&apos;re ready, tap{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Start voice survey
          </span>
          .
        </p>
      ) : (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Continue below when you&apos;re ready.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusPillClass(
            status,
            interviewFinished
          )}`}
        >
          {interviewFinished ? "Voice survey complete" : statusLabel(status)}
        </span>
        {message ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {message}
          </span>
        ) : null}
      </div>

      {localError ? (
        <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
          {localError}
        </p>
      ) : null}

      {info ? (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {info}
        </p>
      ) : null}

      {savedOk && !localError && interviewFinished && !transcriptLoading ? (
        <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Your transcript was saved below.
        </p>
      ) : null}

      {savedOk &&
      !localError &&
      canResume &&
      !interviewFinished &&
      !transcriptLoading ? (
        <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Progress saved—tap{" "}
          <span className="font-medium">Resume voice survey</span> when
          you&apos;re ready. If the transcript hasn&apos;t appeared yet, wait a
          moment, then tap{" "}
          <span className="font-medium">Show latest transcript</span>.
        </p>
      ) : null}

      {transcriptLoading ? (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Your transcript
          </h4>
          <div className="mt-2 flex min-h-[128px] flex-col items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50/50 py-8 dark:border-zinc-700 dark:bg-zinc-950">
            <div
              className="h-7 w-7 animate-spin rounded-full border-2 border-[#1c69d4] border-t-transparent"
              aria-hidden
            />
            <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
              Loading your transcript…
            </p>
          </div>
        </div>
      ) : hasTranscriptTextToShow(transcript) ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Your transcript
            </h4>
            <button
              type="button"
              disabled={!isRenderableTranscript(transcript)}
              onClick={handleDownloadTranscript}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Download as .txt
            </button>
          </div>
          {transcriptSavedAt ? (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Saved{" "}
              {new Date(transcriptSavedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          ) : null}
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 text-left dark:border-zinc-700 dark:bg-zinc-950">
            <pre
              className={`whitespace-pre-wrap break-words font-sans text-xs leading-relaxed ${
                isRenderableTranscript(transcript)
                  ? "text-zinc-800 dark:text-zinc-200"
                  : "text-zinc-500 italic dark:text-zinc-400"
              }`}
            >
              {transcript}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        {!interviewFinished ? (
          <button
            type="button"
            disabled={!canStart || busy || redoBusy || transcriptLoading}
            onClick={() => void handleStart()}
            className="rounded-lg bg-[#1c69d4] px-4 py-2 text-sm font-medium text-white hover:bg-[#1557b0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && canStart ? "Starting…" : startButtonLabel}
          </button>
        ) : null}

        {status === "connected" && !interviewFinished ? (
          <button
            type="button"
            disabled={busy || redoBusy || transcriptLoading}
            onClick={handleEndCallAndSave}
            className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 dark:border-red-900/50 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            {busy || transcriptLoading ? "Saving…" : "Save progress & end"}
          </button>
        ) : null}

        {canRefreshTranscript ? (
          <button
            type="button"
            disabled={busy || redoBusy || transcriptLoading}
            onClick={() => void handleRetryFinalize()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/60"
          >
            Show latest transcript
          </button>
        ) : null}

        {showRedoVoice ? (
          <button
            type="button"
            disabled={busy || redoBusy || transcriptLoading}
            onClick={() => void handleRedoVoiceInterview()}
            className="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {redoBusy ? "Resetting…" : "Redo voice survey"}
          </button>
        ) : null}

        {!interviewFinished ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={isMuted}
              onChange={(e) => setMuted(e.target.checked)}
              className="rounded border-zinc-400 dark:border-zinc-600"
            />
            Mute microphone
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function VoiceInterviewSection(props: VoiceInterviewSectionProps) {
  const [voiceInstanceKey, setVoiceInstanceKey] = useState(0);
  return (
    <ConversationProvider key={voiceInstanceKey}>
      <VoiceInterviewInner
        key={voiceInstanceKey}
        {...props}
        onRedoVoiceInterview={() => setVoiceInstanceKey((k) => k + 1)}
      />
    </ConversationProvider>
  );
}
