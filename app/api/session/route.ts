import { NextResponse } from "next/server";

import { registerRespondent } from "@/lib/store";

/** Register or refresh session stub (called when the respondent lands with a client-generated id). */
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
      ? (body as { respondentId: string }).respondentId
      : null;

  if (!respondentId?.trim()) {
    return NextResponse.json({ error: "respondentId required" }, { status: 400 });
  }

  const record = registerRespondent(respondentId.trim());
  return NextResponse.json({
    respondentId: record.respondentId,
    segment: record.segment,
    submittedAt: record.submittedAt ?? null,
  });
}
