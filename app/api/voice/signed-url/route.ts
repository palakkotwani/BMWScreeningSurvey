import { NextResponse } from "next/server";

import { getConversationSignedUrl } from "@/lib/elevenlabs";
import { getRespondent } from "@/lib/store";

export const runtime = "nodejs";

function isQualifiedSegment(
  s: string | undefined
): s is "bmw_customer" | "potential_bmw_customer" {
  return s === "bmw_customer" || s === "potential_bmw_customer";
}

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();

  if (!apiKey || !agentId) {
    return NextResponse.json(
      {
        error:
          "Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID in server environment.",
      },
      { status: 501 }
    );
  }

  let body: { respondentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const respondentId = body.respondentId?.trim();
  if (!respondentId) {
    return NextResponse.json({ error: "respondentId required" }, { status: 400 });
  }

  const record = getRespondent(respondentId);
  if (!record || !isQualifiedSegment(record.segment)) {
    return NextResponse.json(
      { error: "Respondent is not qualified for the voice interview." },
      { status: 403 }
    );
  }

  try {
    const { signedUrl } = await getConversationSignedUrl(apiKey, agentId);
    return NextResponse.json({
      signedUrl,
      segment: record.segment,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
