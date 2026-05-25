// @paradigm: sql  (pure string/number checks — NO LLM here)
// Phase-2 slice-9 (feat-ai-insight-narration) — BFF-side narration gates.
//
// These are the api-gateway's DEFENSE-IN-DEPTH re-checks of the three slice-9
// non-negotiables. The authoritative enforcement is the intelligence-service
// gateway (Child-5: validate_faithfulness, injection preprocessor, agent tool
// scope). The BFF re-asserts BEFORE render so a bad narration never reaches the
// client even if an upstream check regressed.
//
// CF-S9-FAITHFULNESS-1  : every number in a narration body MUST appear in the
//                         deterministic signal set (LLMs NEVER invent numbers).
// CF-S9-NO-TOOL-REACH-1 : the narration payload carries NO executable action /
//                         tool field — it is recommendation-only, READ surface.
// CF-S9-INJECTION-1     : narration text MUST NOT contain fence/role-control
//                         sequences (a sign the injection preprocessor was bypassed).
//
// The number-normalization rules MIRROR intelligence-service
// domain/faithfulness/extraction.py so both sides canonicalize identically.

import type {
  PageInsightResult,
  PageInsightNarration,
  InsightSignal,
} from './proto-types.js';

const LAKH = 100_000n;
const CRORE = 10_000_000n;

// Mirror of extraction.py regexes (Indian lakh/crore, %, currency, plain int).
// NOTE: the lakh/crore suffix must be a TOKEN, not the first letter of the next
// word — a trailing (?![A-Za-z]) lookahead prevents "CM3 lands"→"3 L" / "CM2 line"
// false matches.  (extraction.py relies on its prose never adjoining digit+L-word;
// the BFF mirror hardens this so narration phrasing cannot create phantom numbers.)
const RE_LAKH = /[-−]?\s*(?:approximately\s+|approx\.?\s+|~\s*)?(?:₹|Rs\.?|INR\s*)?(\d+(?:\.\d+)?)\s*(?:[Ll]akhs?|[Ll])(?![A-Za-z])/g;
const RE_CRORE = /[-−]?\s*(?:approximately\s+|approx\.?\s+|~\s*)?(?:₹|Rs\.?|INR\s*)?(\d+(?:\.\d+)?)\s*(?:[Cc]rores?|[Cc]r)(?![A-Za-z])/g;
const RE_PCT = /[-−]?\s*(\d+(?:\.\d+)?)\s*%/g;
const RE_CURRENCY = /[-−]?\s*(?:₹|Rs\.?|INR\s*)(\d[\d,]*(?:\.\d+)?)/gi;
const RE_PLAIN = /(?<![₹\w])[-−]?\d[\d,]*(?:\.\d+)?(?!\s*[%LlCc])/g;

/** Round-half-up of a decimal*scale to a bigint (matches Python round() for these inputs). */
function scaledToBigint(numStr: string, scale: bigint): bigint {
  if (numStr.includes('.')) {
    const [intPart, fracPart] = numStr.split('.');
    // value = (intPart.fracPart) * scale, rounded to nearest integer.
    // Compute with enough precision using string math via Number for the modest
    // magnitudes in narration (lakh/crore of a 1-2 decimal value) — safe range.
    const asNum = Number(numStr) * Number(scale);
    return BigInt(Math.round(asNum));
  }
  return BigInt(intPart_safe(numStr)) * scale;
}

function intPart_safe(s: string): string {
  return s.replace(/,/g, '');
}

/**
 * Extract all numbers from a narration as canonical bigint minor units / bp.
 * MIRRORS intelligence-service extraction.extract_numbers() — same ordering,
 * same span-overlap de-dup so a value is normalized exactly once.
 */
export function extractNumbers(text: string): bigint[] {
  const consumed: Array<[number, number]> = [];
  const results: bigint[] = [];

  const register = (value: bigint, span: [number, number]): void => {
    for (const cs of consumed) {
      if (span[0] < cs[1] && span[1] > cs[0]) return; // overlap → skip
    }
    consumed.push(span);
    if (!results.some((r) => r === value)) results.push(value);
  };

  const runPass = (
    re: RegExp,
    toValue: (raw: string, grp: string) => bigint | null,
  ): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0];
      const negative = raw.trimStart().startsWith('-') || raw.trimStart().startsWith('−');
      const v = toValue(raw, m[1] ?? m[0]);
      if (v !== null) register(negative ? -v : v < 0n ? v : v, [m.index, m.index + raw.length]);
    }
  };

  // 1. Lakh
  runPass(RE_LAKH, (_raw, g) => scaledToBigint(g, LAKH));
  // 2. Crore
  runPass(RE_CRORE, (_raw, g) => scaledToBigint(g, CRORE));
  // 3. Percentage → basis points
  runPass(RE_PCT, (_raw, g) => scaledToBigint(g, 100n));
  // 4. Currency-prefixed integers
  runPass(RE_CURRENCY, (_raw, g) => {
    const cleaned = g.replace(/,/g, '');
    if (cleaned.includes('.')) return BigInt(Math.trunc(Number(cleaned)));
    try {
      return BigInt(cleaned);
    } catch {
      return null;
    }
  });
  // 5. Plain numbers
  runPass(RE_PLAIN, (raw) => {
    const cleaned = raw.replace(/,/g, '').replace('−', '-').trim();
    if (cleaned === '' || cleaned === '-') return null;
    if (cleaned.includes('.')) return BigInt(Math.trunc(Number(cleaned)));
    try {
      return BigInt(cleaned);
    } catch {
      return null;
    }
  });

  return results;
}

/**
 * CF-S9-FAITHFULNESS-1: assert every number in EVERY narration body+headline is
 * present in the deterministic signal set. Throws on the first hallucinated number.
 * This is the BFF mirror of validate_faithfulness — "LLMs NEVER invent numbers".
 *
 * Mutant probe: a narration that says "CM2 was ₹4.0L" when the signal is 32_000_000
 * (₹3.2L) → 400000 ∉ {320000...} → throws.
 */
export function assertInsightFaithfulness(result: PageInsightResult): void {
  const signalValues = new Set<bigint>(result.signals.map((s) => s.value_canonical));

  for (const n of result.narrations) {
    const text = `${n.headline} ${n.body}`;
    const numbers = extractNumbers(text);
    for (const num of numbers) {
      if (!signalValues.has(num)) {
        throw new Error(
          `CF-S9-FAITHFULNESS-1 VIOLATION: narration ${n.insight_id} cites ` +
            `${num.toString()} which is NOT in the deterministic signal set. ` +
            `LLMs NEVER invent numbers — narration must be grounded in registry signals.`,
        );
      }
    }
    // Every cited signal_id must exist in the signal set (no orphan grounding ref).
    for (const sid of n.grounded_signal_ids) {
      if (!result.signals.some((s) => s.signal_id === sid)) {
        throw new Error(
          `CF-S9-FAITHFULNESS-1 VIOLATION: narration ${n.insight_id} references ` +
            `signal_id "${sid}" not present in the signal set.`,
        );
      }
    }
  }
}

// Sequences that signal an attempt to control the model / break the fence.
// If any appear in the OUTPUT narration, the injection preprocessor was bypassed.
const INJECTION_OUTPUT_SEQUENCES = [
  '</data>',
  '<data',
  '</prior_agent_output>',
  '<prior_agent_output',
  '</system>',
  '<system',
  '</instruction>',
  '<instruction',
  'ignore previous instructions',
  'disregard all prior',
  'you are now',
];

/**
 * CF-S9-INJECTION-1: assert the rendered narration carries no fence/role-control
 * sequences. Defense-in-depth: untrusted commerce text is fenced + sentinel-escaped
 * upstream; if a control sequence survived into output, fail closed.
 */
export function assertNoInjectionInOutput(result: PageInsightResult): void {
  for (const n of result.narrations) {
    const haystack = `${n.headline}\n${n.body}`.toLowerCase();
    for (const seq of INJECTION_OUTPUT_SEQUENCES) {
      if (haystack.includes(seq.toLowerCase())) {
        throw new Error(
          `CF-S9-INJECTION-1 VIOLATION: narration ${n.insight_id} contains a ` +
            `fence/role-control sequence ("${seq}"). The injection preprocessor was ` +
            `bypassed — refusing to render. Fail-closed.`,
        );
      }
    }
  }
}

/**
 * CF-S9-NO-TOOL-REACH-1: assert the narration payload exposes NO executable
 * action / tool field. This surface is recommendation-only (READ). A narration
 * object must be {insight_id, severity, headline, body, grounded_signal_ids} —
 * no `action`, no `tool`, no `execute`, no `mutation`, no write target.
 *
 * Mutant probe: adding an `action: "PAUSE_AD_SET"` field to a narration → throws.
 */
const FORBIDDEN_ACTION_KEYS = ['action', 'tool', 'tool_call', 'execute', 'mutation', 'write', 'dispatch', 'send'];

export function assertNoToolReach(narration: PageInsightNarration): void {
  for (const key of Object.keys(narration)) {
    if (FORBIDDEN_ACTION_KEYS.includes(key.toLowerCase())) {
      throw new Error(
        `CF-S9-NO-TOOL-REACH-1 VIOLATION: narration ${narration.insight_id} exposes ` +
          `a forbidden executable field "${key}". The narration surface is READ-only ` +
          `(recommendation-only-until-graduated) and reaches NO write/MCP tool.`,
      );
    }
  }
}

/** Convenience: assert all three slice-9 gates over a full page result. */
export function assertPageInsightGates(result: PageInsightResult): void {
  if (!result.faithfulness_ok) {
    throw new Error(
      `CF-S9-FAITHFULNESS-1 VIOLATION: upstream faithfulness_ok=false for page ` +
        `"${result.page}". Refusing to render an ungrounded narration.`,
    );
  }
  if (result.paradigm !== 'small_llm') {
    throw new Error(
      `CF-S9-PARADIGM-1 VIOLATION: page insight paradigm="${result.paradigm}" — ` +
        `narration is small_llm ONLY (never frontier per page).`,
    );
  }
  assertInsightFaithfulness(result);
  assertNoInjectionInOutput(result);
  for (const n of result.narrations) assertNoToolReach(n);
}

/** Re-export for fixed-signal mirroring with the InsightSignal type. */
export type { InsightSignal };
