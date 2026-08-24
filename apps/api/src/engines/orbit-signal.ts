import { and, desc, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { audit, type Ctx } from "@lyra/core";
import { type Gateway } from "@lyra/model-gateway";

// The conversation-signal half of ORBIT §2.1's promise: "sentiment, language
// auto-detect (ar/en incl. Arabizi)". Both fields on `orbit_conversations`
// were dead seams — the churn model read `lastSentiment` as a real input and
// the routing engine offered a `sentimentBelow` condition, but nothing ever
// wrote either, so the sentiment term was permanently null and the routing
// condition could never fire. This engine is the writer.
//
// Language is deterministic, not a model call: Arabic script → ar, Latin
// script with Arabic-in-Latin ("Arabizi") markers → ar, otherwise en. Arabizi
// detection is heuristic by nature (it is Latin letters spelling Arabic), so
// it keys on the distinctive numerals-and-digraphs customers actually type —
// documented as a heuristic, not claimed as a model.
//
// Sentiment is a fast-tier model call over the customer's own words, clamped
// to -100..100 and cached onto the conversation. It runs per inbound message;
// the conversation carries the latest reading.

export type ConversationLang = "ar" | "en";

/** Arabizi markers: 3/7/5/2 standing for Arabic letters, and common digraphs
 *  that only appear in Arabic-in-Latin typing. Deliberately conservative — a
 *  false "ar" misroutes a whole conversation. */
const ARABIZI_PATTERNS = [
  /\b[aeiou]?3[a-z]*\b/i, // 3 = ع
  /(?:^|\s)7(?:a|e|i|)(?:\b|s)/i, // 7 = ح
  /(?:^|\s)5alas|khalas|(?:^|\s)5\b/i, // 5 = خ
  /\bshu\b|\bkif\b|\bhalla\b|\byalla\b|\bhabibi\b|\bwalla\b/i,
  /\bmashi\b|\bmfeesh?\b|\bakid\b/i
];

/**
 * Detect the conversation language from a message. Pure and instant:
 *   - Any Arabic-script character → "ar".
 *   - Otherwise, two or more distinct Arabizi markers → "ar" (Latin-scripted
 *     Arabic; one marker alone is too weak — "3rd", "7 days" are English).
 *   - Otherwise "en".
 */
export function detectLang(text: string): ConversationLang {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  const hits = new Set<string>();
  for (const pattern of ARABIZI_PATTERNS) {
    const m = text.match(pattern);
    if (m) hits.add(m[0].toLowerCase());
  }
  return hits.size >= 2 ? "ar" : "en";
}

export interface ConversationSignal {
  lang: ConversationLang;
  /** -100..100; negative is unhappy. */
  sentiment: number;
}

/** Clamp to the column's documented range. */
function clampSentiment(n: number): number {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

/**
 * Analyse one inbound customer message: deterministic lang, model sentiment.
 * Returns null when the model fails — the caller keeps the previous signal
 * rather than writing a guess.
 */
export async function analyseMessage(
  ctx: Ctx,
  gateway: Gateway,
  conversationId: string,
  text: string
): Promise<ConversationSignal | null> {
  const lang = detectLang(text);
  try {
    const res = await gateway.complete(ctx, {
      module: "orbit",
      purpose: "conversation.signal",
      tier: "fast",
      subjectRef: conversationId,
      locale: lang,
      messages: [
        {
          role: "system",
          content:
            "You read one customer message and rate its sentiment from the customer's point of view. " +
            "Reply with JSON only: {\"sentiment\": <integer -100..100>}. " +
            "0 is neutral; positive means satisfied or friendly; negative means frustrated, angry or resigning. " +
            "Arabic, English and Arabizi (Arabic typed in Latin letters) are all readable natively."
        },
        { role: "user", content: text }
      ]
    });
    const parsed = JSON.parse(res.text) as { sentiment?: unknown };
    if (typeof parsed.sentiment !== "number" || !Number.isFinite(parsed.sentiment)) return null;
    return { lang, sentiment: clampSentiment(parsed.sentiment) };
  } catch {
    return null;
  }
}

/**
 * Apply a signal to its conversation. Called from the inbound channel path
 * after the message lands — the conversation's `lang` and `sentiment` then
 * feed routing (`sentimentBelow`) and the churn model (`lastSentiment`).
 *
 * Language always updates when detected; sentiment only when the model gave
 * a reading, so a failed call leaves the previous value standing rather than
 * nulling it.
 */
export async function applySignal(ctx: Ctx, conversationId: string, signal: ConversationSignal | null): Promise<void> {
  if (!signal) return;
  // Clamp here as well as at the parse site: the column's range is a storage
  // invariant, and applySignal is also the entry point for callers that build
  // signals themselves.
  const sentiment = Math.max(-100, Math.min(100, Math.round(signal.sentiment)));
  await ctx.db
    .update(schema.orbitConversations)
    .set({ lang: signal.lang, sentiment, updatedAt: ctx.now })
    .where(and(eq(schema.orbitConversations.tenantId, ctx.tenantId), eq(schema.orbitConversations.id, conversationId)));
}

/**
 * Convenience wrapper for the inbound path: analyse + apply + audit in one
 * call. Audit failure is deliberately non-fatal — the annotation is ambient.
 */
export async function recordSignal(ctx: Ctx, gateway: Gateway, conversationId: string, customerId: string | null, text: string): Promise<void> {
  const signal = await analyseMessage(ctx, gateway, conversationId, text);
  if (!signal) return;
  await applySignal(ctx, conversationId, signal);
  await audit(ctx, {
    action: "orbit.conversation.signal",
    subjectRef: `conversations:${conversationId}`,
    after: { lang: signal.lang, sentiment: signal.sentiment, ...(customerId ? { customerId } : {}) }
  });
}

/** Latest signal-bearing conversations for a customer — what the churn
 *  feature query already reads, kept here for symmetry with the writer. */
export async function latestSentimentFor(ctx: Ctx, customerId: string): Promise<number | null> {
  const [row] = await ctx.db
    .select({ sentiment: schema.orbitConversations.sentiment })
    .from(schema.orbitConversations)
    .where(and(eq(schema.orbitConversations.tenantId, ctx.tenantId), eq(schema.orbitConversations.customerId, customerId)))
    .orderBy(desc(schema.orbitConversations.lastMessageAt))
    .limit(1);
  return row?.sentiment ?? null;
}
