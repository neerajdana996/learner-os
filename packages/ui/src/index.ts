// Public surface of the design system.
//
// Everything here is presentational and depends on nothing but React and
// @learnos/shared — no store, no router, no data fetching. That is the rule
// that decides whether a component belongs in this package: if it needs to
// know where its data came from, it belongs to the app that fetched it.
//
// Styles live beside these, in `@learnos/ui/styles`. A component here renders
// class names; it never carries its own CSS.
export { Button, type ButtonProps } from './Button.js';
export { Choice, type ChoiceProps } from './Choice.js';
export { ConceptDot, ConceptLegend } from './ConceptDot.js';
export { ConfidenceTap, type ConfidenceTapProps } from './ConfidenceTap.js';
export { Field, type FieldProps } from './Field.js';
export { Prose, renderCodeSpans } from './Prose.js';
export { QuestionCard, type QuestionCardProps } from './QuestionCard.js';
export { CheckCircle, ChevronDown, GitHubMark, GoogleMark, TrendDown, TrendUp } from './Icon.js';

export { BlockList } from './blocks/BlockList.js';
export { DrawingBlock } from './blocks/DrawingBlock.js';
export { ClozeCode, joinCloze, splitCloze, CLOZE_SEPARATOR } from './blocks/ClozeCode.js';
export { HotspotLine } from './blocks/HotspotLine.js';
export { CodeBlock } from './blocks/CodeBlock.js';
export { CodeDiffBlock, diffRows } from './blocks/CodeDiffBlock.js';
export { TerminalBlock } from './blocks/TerminalBlock.js';
