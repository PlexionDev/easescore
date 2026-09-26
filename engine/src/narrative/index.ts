export * from "./types";
export { generateNarrative, canBuildSentence, pencilsSentence, barrierLines, nextStepLines, ROUTINE_REQUIREMENTS, DECISION_IMPACT } from "./templates";
export { validateNarrative, validateResult, extractNumbers, factPool, type NumberToken } from "./validate";
export { derive, proFormaMath, type Derived } from "./derive";
export {
  mathInWords, money, moneyRange, pct, months, weeks, roundMoney, term, parseTerms, stripTerms, GLOSSARY,
  type MathOp, type MathTerm, type MathStep, type MathSentence, type TermSegment,
} from "./format";
export { toNarrativeFacts, fromStrategyResult, zoningFromFit, usePathFromPermission, type ScoreOutputLike, type NarrativeInputs } from "./adapter";
export {
  generateSummary, validateSummary, resolveSummary, precedentPhrase, splitSentences, SUMMARY_FINE_PRINT, PRECEDENT_MIN_CASES, BANNED_PATTERNS,
  type SummaryInput, type SummaryOption, type SummaryApprovalOption, type SummaryPrecedent, type SummaryResult, type SummaryValidation, type ReliefType,
} from "./summary";
