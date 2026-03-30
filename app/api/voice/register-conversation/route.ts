import { NextResponse } from "next/server";

import { getRespondent, patchInterview } from "@/lib/store";

export const runtime = "nodejs";

function isQualifiedSegment(
  s: string | undefined
): s is "bmw_customer" | "potential_bmw_customer" {
  return s === "bmw_customer" || s === "potential_bmw_customer";
}

export async function POST(req: Request) {
  let body: { respondentId?: string; conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const respondentId = body.respondentId?.trim();
  const conversationId = body.conversationId?.trim();
  if (!respondentId || !conversationId) {
    return NextResponse.json(
      { error: "respondentId and conversationId required" },
      { status: 400 }
    );
  }

  const record = getRespondent(respondentId);
  if (!record || !isQualifiedSegment(record.segment)) {
    return NextResponse.json({ error: "Not qualified" }, { status: 403 });
  }

  /** Do not set interviewStatus here — that made every fresh connect look like “resume” after a reload.
   * `in_progress` is set only when `/api/voice/finalize` saves partial or full transcript. */
  const next = patchInterview(respondentId, {
    elevenLabsConversationId: conversationId,
    interviewError: undefined,
  });

  if (!next) {
    return NextResponse.json({ error: "Respondent not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, conversationId });
}
