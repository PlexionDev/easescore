export * from "./types";
export { generateNarrative, canBuildSentence, pencilsSentence, barrierLines, nextStepLines } from "./templates";
export { validateNarrative, validateResult, extractNumbers, factPool, type NumberToken } from "./validate";
export { derive, proFormaMath, type Derived } from "./derive";
export {
  mathInWords, money, moneyRange, pct, months, weeks, roundMoney, term, parseTerms, stripTerms, GLOSSARY,
  type MathOp, type MathTerm, type MathStep, type MathSentence, type TermSegment,
} from "./format";
export { toNarrativeFacts, fromStrategyResult, zoningFromFit, usePathFromPermission, type ScoreOutputLike, type NarrativeInputs } from "./adapter";
