import { hasExplicitKnowledgeUncertainty } from "./knowledge-import";

function signalsMissingEvidence(value: string) {
  const text = value
    .replace(/[’‘]/g, "'")
    .replace(/n't\b/gi, " not")
    .replace(/\s+/g, " ");
  return (
    hasExplicitKnowledgeUncertainty(text) ||
    /\b(?:unverified|unspecified|undetermined|uncertain|unclear|provisional|tentative|tbd|conflicting|pending confirmation|subject to confirmation|yet to be (?:confirmed|determined))\b/i.test(
      text,
    ) ||
    /\b(?:(?:document|guide|record|source) contains no|no (?:verified|confirmed|information|details|evidence)|not (?:yet )?(?:been )?(?:measured|verified|specified|established|determined|confirmed|published|known)|(?:cannot|not|unable to) (?:confirm|verify|guarantee))\b/i.test(
      text,
    ) ||
    /\bno\b[^.!?\n]{0,50}\bis guaranteed\b/i.test(text)
  );
}

// Uncited neighbours remain available to the reviewer for contradiction checks.
// Their wording alone should not escalate a question about a different fact.
export function needsStrongerGroundingReview(
  language: string,
  references: ReadonlyArray<{ content: string }>,
  reply: string,
) {
  return (
    !/^(?:english|en(?:-[a-z]{2})?)$/i.test(language) ||
    signalsMissingEvidence(reply) ||
    references.some(({ content }) => signalsMissingEvidence(content))
  );
}
