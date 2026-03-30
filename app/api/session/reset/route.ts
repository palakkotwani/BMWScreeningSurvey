import { NextResponse } from "next/server";

import {
  resetRespondentForRetake,
  resetSurveyKeepVoiceInterview,
} from "@/lib/store";

export const runtime = "nodejs";

/**
 * Clear saved qualification so they can submit again (same id).
 * Optional `keepVoiceInterview: true` keeps Part 2 transcript / status on the record.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const o =
    typeof body === "object" && body !== null
      ? (body as {
          respondentId?: unknown;
          keepVoiceInterview?: unknown;
        })
      : null;

  const respondentId =
    typeof o?.respondentId === "string" ? o.respondentId.trim() : "";

  const keepVoiceInterview = o?.keepVoiceInterview === true;

  if (!respondentId) {
    return NextResponse.json({ error: "respondentId required" }, { status: 400 });
  }

  if (keepVoiceInterview) {
    const record = resetSurveyKeepVoiceInterview(respondentId);
    if (!record) {
      return NextResponse.json({ error: "Respondent not found" }, { status: 404 });
    }
    return NextResponse.json({
      respondentId: record.respondentId,
      segment: record.segment,
      keepVoiceInterview: true,
    });
  }

  const record = resetRespondentForRetake(respondentId);
  return NextResponse.json({
    respondentId: record.respondentId,
    segment: record.segment,
    keepVoiceInterview: false,
  });
}
