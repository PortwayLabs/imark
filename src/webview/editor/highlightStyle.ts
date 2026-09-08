// Highlight style producing Obsidian/CodeMirror-5 style class names (`cm-keyword`,
// `cm-string`, …) for fenced code blocks and inline HTML, so Obsidian themes can
// colour code. Markdown structure itself is decorated by the live preview plugin.
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const obsidianHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], class: 'cm-keyword' },
  { tag: [t.name, t.character, t.macroName], class: 'cm-variable' },
  { tag: [t.propertyName], class: 'cm-property' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'cm-variable-2 cm-def' },
  { tag: [t.labelName], class: 'cm-def' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], class: 'cm-def' },
  { tag: [t.typeName, t.className, t.namespace], class: 'cm-type' },
  { tag: [t.number, t.integer, t.float, t.unit], class: 'cm-number' },
  { tag: [t.bool, t.null, t.atom, t.color, t.constant(t.name), t.standard(t.name)], class: 'cm-atom' },
  { tag: [t.string, t.special(t.string), t.docString, t.attributeValue], class: 'cm-string' },
  { tag: [t.regexp, t.escape], class: 'cm-string-2' },
  { tag: [t.comment, t.lineComment, t.blockComment], class: 'cm-comment' },
  { tag: [t.operator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator, t.definitionOperator, t.derefOperator], class: 'cm-operator' },
  { tag: [t.punctuation, t.separator], class: 'cm-punctuation' },
  { tag: [t.paren, t.squareBracket, t.brace, t.angleBracket, t.bracket], class: 'cm-bracket' },
  { tag: [t.tagName], class: 'cm-tag' },
  { tag: [t.attributeName], class: 'cm-attribute' },
  { tag: [t.meta, t.documentMeta, t.annotation, t.processingInstruction], class: 'cm-meta' },
  { tag: [t.invalid], class: 'cm-error' },
  { tag: [t.heading], class: 'cm-header' },
  { tag: [t.strong], class: 'cm-strong' },
  { tag: [t.emphasis], class: 'cm-em' },
  { tag: [t.strikethrough], class: 'cm-strikethrough' },
  { tag: [t.link], class: 'cm-link' },
  { tag: [t.url], class: 'cm-url' },
  { tag: [t.quote], class: 'cm-quote' },
  { tag: [t.inserted], class: 'cm-positive' },
  { tag: [t.deleted], class: 'cm-negative' },
  { tag: [t.changed], class: 'cm-variable-3' },
  { tag: [t.special(t.variableName)], class: 'cm-variable-2' },
  { tag: [t.local(t.variableName)], class: 'cm-variable' },
]);
