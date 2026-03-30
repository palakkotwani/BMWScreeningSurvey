import { NextResponse } from "next/server";

import { PLACEHOLDER_TRANSCRIPT } from "@/lib/placeholder-transcript";
import { getRespondent } from "@/lib/store";
import type { Segment } from "@/lib/types";

function qualified(segment: Segment): boolean {
  return segment === "bmw_customer" || segment === "potential_bmw_customer";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ respondentId: string }> }
) {
  const { respondentId } = await ctx.params;
  const decoded = decodeURIComponent(respondentId);
  const record = getRespondent(decoded);

  if (!record) {
    return NextResponse.json(
      {
        respondentId: decoded,
        segment: null as Segment | null,
        surveyComplete: false,
        qualified: false,
      },
      { status: 200 }
    );
  }

  const complete = record.segment !== "pending";

  const transcriptNeedsPullFromEl = (t: string | undefined | null): boolean => {
    if (!t?.trim()) return true;
    return t.trim() === PLACEHOLDER_TRANSCRIPT;
  };

  /** Client should POST /api/voice/finalize to hydrate from ElevenLabs on load. */
  const voiceNeedsSync = Boolean(
    record.elevenLabsConversationId?.trim() &&
      (record.interviewStatus === undefined ||
        ((record.interviewStatus === "in_progress" ||
          record.interviewStatus === "completed") &&
          transcriptNeedsPullFromEl(record.interviewTranscript ?? null)))
  );

  return NextResponse.json({
    respondentId: record.respondentId,
    segment: record.segment,
    surveyComplete: complete,
    qualified: qualified(record.segment),
    screenOutReason: record.screenOutReason ?? null,
    submittedAt: record.submittedAt ?? null,
    interviewStatus: record.interviewStatus ?? null,
    interviewTranscript: record.interviewTranscript ?? null,
    interviewCompletedAt: record.interviewCompletedAt ?? null,
    interviewError: record.interviewError ?? null,
    voiceNeedsSync,
  });
}
