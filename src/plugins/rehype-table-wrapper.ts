import type { Element, Root } from 'hast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'

/**
 * Wraps every `<table>` in a `<div class="table-wrapper">` so wide tables can
 * scroll horizontally on their own instead of overflowing the article column.
 */
export const rehypeTableWrapper: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'element', (node, index, parent) => {
    if (!parent || index === undefined) return
    if (node.tagName !== 'table') return

    const wrapper: Element = {
      type: 'element',
      tagName: 'div',
      properties: { className: ['table-wrapper'] },
      children: [node],
    }

    parent.children[index] = wrapper
  })
}
