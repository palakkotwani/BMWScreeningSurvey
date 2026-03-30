import { NextResponse } from "next/server";

import { ingestFormResponse } from "@/lib/ingest-form-response";

export const runtime = "nodejs";

type TypeformResponseItem = {
  token?: string;
  submitted_at?: string;
  hidden?: Record<string, string>;
  answers?: unknown[];
};

type TypeformResponsesApi = {
  items?: TypeformResponseItem[];
  total_items?: number;
};

const MAX_RETRIES = 10;
const RETRY_MS = 1500;

async function fetchResponseWithRetry(
  formId: string,
  accessToken: string,
  responseId: string
): Promise<TypeformResponseItem | undefined> {
  const urlBase = `https://api.typeform.com/forms/${formId}/responses`;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const url = `${urlBase}?included_response_ids=${encodeURIComponent(responseId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Typeform API ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as TypeformResponsesApi;
    const item = data.items?.[0];
    if (item) return item;
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
  return undefined;
}

/**
 * Pull a completed response from Typeform by ID (fallback when webhook is unavailable).
 * Requires TYPEFORM_ACCESS_TOKEN (personal token from Typeform account).
 */
export async function POST(req: Request) {
  const accessToken = process.env.TYPEFORM_ACCESS_TOKEN?.trim();
  const formId = process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID?.trim();

  let body: { responseId?: string; respondentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const responseId = body.responseId?.trim();
  const respondentId = body.respondentId?.trim();

  if (!responseId) {
    return NextResponse.json({ error: "responseId required" }, { status: 400 });
  }

  if (!accessToken || !formId) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "TYPEFORM_ACCESS_TOKEN or form id not set — relying on webhook",
    });
  }

  try {
    const item = await fetchResponseWithRetry(formId, accessToken, responseId);
    if (!item) {
      return NextResponse.json(
        {
          error:
            "Response not available from Typeform API yet. Webhooks are more reliable for instant results.",
        },
        { status: 502 }
      );
    }

    if (
      respondentId &&
      item.hidden?.respondent_id &&
      item.hidden.respondent_id !== respondentId
    ) {
      return NextResponse.json(
        { error: "respondentId does not match response hidden fields" },
        { status: 403 }
      );
    }

    const result = ingestFormResponse({
      token: item.token,
      submitted_at: item.submitted_at,
      hidden: item.hidden,
      answers: item.answers,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, segment: result.segment });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
