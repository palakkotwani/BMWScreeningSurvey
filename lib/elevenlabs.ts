const API_ORIGIN = "https://api.elevenlabs.io";

export async function getConversationSignedUrl(
  apiKey: string,
  agentId: string,
  options?: { includeConversationId?: boolean }
): Promise<{ signedUrl: string }> {
  const params = new URLSearchParams({ agent_id: agentId });
  if (options?.includeConversationId) {
    params.set("include_conversation_id", "true");
  }
  const res = await fetch(
    `${API_ORIGIN}/v1/convai/conversation/get-signed-url?${params.toString()}`,
    {
      method: "GET",
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `ElevenLabs get-signed-url failed ${res.status}: ${text.slice(0, 300)}`
    );
  }
  const data = (await res.json()) as { signed_url: string };
  if (!data.signed_url) {
    throw new Error("ElevenLabs response missing signed_url");
  }
  return { signedUrl: data.signed_url };
}

/** Best-effort transcript extraction from GET /v1/convai/conversations/{id} response. */
export function extractTranscriptFromConversationPayload(data: unknown): string {
  if (data == null || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;

  if (typeof o.transcript === "string") return o.transcript;

  if (Array.isArray(o.transcript)) {
    return o.transcript
      .map((turn) => {
        if (turn && typeof turn === "object") {
          const t = turn as Record<string, unknown>;
          const role = t.role ?? t.source ?? "turn";
          const msg =
            t.message ??
            t.text ??
            t.content ??
            (Array.isArray(t.transcript) ? JSON.stringify(t.transcript) : "");
          return `${String(role)}: ${String(msg)}`;
        }
        return JSON.stringify(turn);
      })
      .join("\n\n");
  }

  if (o.analysis && typeof o.analysis === "object") {
    const a = o.analysis as Record<string, unknown>;
    if (typeof a.transcript_summary === "string") return a.transcript_summary;
  }

  return JSON.stringify(data, null, 2);
}

export async function fetchConversationDetails(
  apiKey: string,
  conversationId: string
): Promise<unknown> {
  const res = await fetch(
    `${API_ORIGIN}/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "GET",
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `ElevenLabs get conversation failed ${res.status}: ${text.slice(0, 300)}`
    );
  }
  return res.json() as Promise<unknown>;
}
