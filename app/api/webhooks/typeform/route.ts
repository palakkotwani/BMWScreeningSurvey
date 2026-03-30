import { NextResponse } from "next/server";

import { ingestFormResponse } from "@/lib/ingest-form-response";
import { verifyTypeformSignature } from "@/lib/typeform-verify";

export const runtime = "nodejs";

type FormResponseBody = {
  form_response?: {
    token?: string;
    submitted_at?: string;
    hidden?: Record<string, string>;
    answers?: unknown[];
  };
};

export async function POST(req: Request) {
  const rawBody = await req.text();
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET ?? "";
  const skipVerify = process.env.TYPEFORM_SKIP_SIGNATURE_VERIFY === "true";

  const sig =
    req.headers.get("typeform-signature") ??
    req.headers.get("Typeform-Signature");

  if (!skipVerify && secret) {
    if (!verifyTypeformSignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let body: FormResponseBody;
  try {
    body = JSON.parse(rawBody) as FormResponseBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fr = body.form_response;
  if (!fr) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const result = ingestFormResponse({
    token: fr.token,
    submitted_at: fr.submitted_at,
    hidden: fr.hidden,
    answers: fr.answers,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, segment: result.segment });
}
