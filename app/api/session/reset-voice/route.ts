import { NextResponse } from "next/server";

import { clearVoiceInterviewOnly, getRespondent } from "@/lib/store";
import type { Segment } from "@/lib/types";

export const runtime = "nodejs";

function isQualifiedSegment(
  s: Segment
): s is "bmw_customer" | "potential_bmw_customer" {
  return s === "bmw_customer" || s === "potential_bmw_customer";
}

/** Clear saved voice interview / transcript; keep screening qualification. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const respondentId =
    typeof body === "object" &&
    body !== null &&
    "respondentId" in body &&
    typeof (body as { respondentId: unknown }).respondentId === "string"
      ? (body as { respondentId: string }).respondentId.trim()
      : "";

  if (!respondentId) {
    return NextResponse.json({ error: "respondentId required" }, { status: 400 });
  }

  const record = getRespondent(respondentId);
  if (!record || !isQualifiedSegment(record.segment)) {
    return NextResponse.json({ error: "Not qualified for voice reset" }, { status: 403 });
  }

  const next = clearVoiceInterviewOnly(respondentId);
  if (!next) {
    return NextResponse.json({ error: "Respondent not found" }, { status: 404 });
  }

  return NextResponse.json({
    respondentId: next.respondentId,
    segment: next.segment,
  });
}
