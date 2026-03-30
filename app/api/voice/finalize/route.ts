import { NextResponse } from "next/server";

import {
  extractTranscriptFromConversationPayload,
  fetchConversationDetails,
} from "@/lib/elevenlabs";
import { PLACEHOLDER_TRANSCRIPT } from "@/lib/placeholder-transcript";
import { getRespondent, patchInterview } from "@/lib/store";
import type { InterviewStatus } from "@/lib/types";

export const runtime = "nodejs";

function isQualifiedSegment(
  s: string | undefined
): s is "bmw_customer" | "potential_bmw_customer" {
  return s === "bmw_customer" || s === "potential_bmw_customer";
}

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY not configured" },
      { status: 501 }
    );
  }

  let body: {
    respondentId?: string;
    conversationId?: string;
    partial?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const partial = body.partial === true;
  const respondentId = body.respondentId?.trim();
  const conversationId =
    body.conversationId?.trim() ||
    getRespondent(body.respondentId?.trim() ?? "")?.elevenLabsConversationId;

  if (!respondentId) {
    return NextResponse.json({ error: "respondentId required" }, { status: 400 });
  }

  const record = getRespondent(respondentId);
  if (!record || !isQualifiedSegment(record.segment)) {
    return NextResponse.json({ error: "Not qualified" }, { status: 403 });
  }

  if (record.interviewStatus === "completed" && partial) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      interviewStatus: "completed" as InterviewStatus,
      transcript: record.interviewTranscript ?? "",
      interviewCompletedAt: record.interviewCompletedAt ?? null,
    });
  }

  const convId = conversationId || record.elevenLabsConversationId;
  if (!convId) {
    return NextResponse.json(
      { error: "No conversationId — connect a voice session first." },
      { status: 400 }
    );
  }

  try {
    const payload = await fetchConversationDetails(apiKey, convId);
    const transcript = extractTranscriptFromConversationPayload(payload);
    const completedAt = new Date().toISOString();
    const storedText = transcript.trim() || PLACEHOLDER_TRANSCRIPT;

    const minLen = 80;
    const looksComplete = transcript.trim().length >= minLen;

    if (partial) {
      patchInterview(respondentId, {
        interviewTranscript: storedText,
        interviewStatus: "in_progress",
        interviewCompletedAt: undefined,
        interviewError: looksComplete
          ? undefined
          : "Partial save: transcript may still be processing on ElevenLabs.",
      });

      return NextResponse.json({
        ok: true,
        partial: true,
        conversationId: convId,
        transcript: storedText,
        interviewStatus: "in_progress" as InterviewStatus,
        transcriptLength: transcript.length,
        warning: looksComplete ? undefined : "short_transcript",
      });
    }

    patchInterview(respondentId, {
      interviewTranscript: storedText,
      interviewStatus: "completed",
      interviewCompletedAt: completedAt,
      interviewError: looksComplete
        ? undefined
        : "Transcript was very short; ElevenLabs may still be processing.",
    });

    return NextResponse.json({
      ok: true,
      conversationId: convId,
      transcript: storedText,
      interviewCompletedAt: completedAt,
      interviewStatus: "completed" as InterviewStatus,
      transcriptLength: transcript.length,
      warning: looksComplete ? undefined : "short_transcript",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (partial) {
      patchInterview(respondentId, {
        interviewStatus: "in_progress",
        interviewError: message,
      });
    } else {
      patchInterview(respondentId, {
        interviewStatus: "failed",
        interviewError: message,
      });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
