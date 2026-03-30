import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify Typeform webhook `typeform-signature` header (`sha256=<base64>`).
 * @see https://developer.typeform.com/webhooks/secure-your-webhooks/
 */
export function verifyTypeformSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  const received = signatureHeader.trim().replace(/^sha256=/i, "");

  if (received.length !== expected.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(received, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}
