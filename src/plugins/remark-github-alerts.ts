import type { Root } from 'mdast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'
import type { AdmonitionType } from '~/types'
import { h as _h, type Properties } from 'hastscript'
import type { Paragraph as P } from 'mdast'

/** From Astro Starlight: Function that generates an mdast HTML tree ready for conversion to HTML by rehype. */
function h(el: string, attrs: Properties = {}, children: any[] = []): P {
  const { properties, tagName } = _h(el, attrs)
  return {
    children,
    data: { hName: tagName, hProperties: properties },
    type: 'paragraph',
  }
}

// GitHub Alerts syntax: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`
const AlertMarker = /^\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]/i

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Turns GitHub-style blockquote alerts (`> [!NOTE]`) into the same
 * `<aside class="admonition">` markup the theme already styles, so they reuse
 * the existing colors and icons.
 *
 * Works alongside `remark-admonitions` (the original `:::note` directive syntax).
 */
export const remarkGithubAlerts: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'blockquote', (node, index, parent) => {
    if (!parent || index === undefined) return

    const first = node.children[0]
    if (first?.type !== 'paragraph') return

    const firstText = first.children[0]
    if (firstText?.type !== 'text') return

    const match = AlertMarker.exec(firstText.value)
    if (!match) return

    const type = match[1].toLowerCase() as AdmonitionType

    // Remove the `[!TYPE]` marker (and any following whitespace / line break).
    firstText.value = firstText.value.slice(match[0].length).replace(/^[ \t]*\n?/, '')

    // Drop now-empty text / paragraph nodes so the alert content stays clean.
    if (firstText.value === '') first.children.shift()
    if (first.children.length === 0) node.children.shift()

    const title = capitalize(type)

    const admonition = h(
      'aside',
      {
        'aria-label': title,
        class: 'admonition',
        'data-admonition-type': type,
      },
      [
        h('p', { class: 'admonition-title', 'aria-hidden': 'true' }, [
          { type: 'text', value: title },
        ]),
        h('div', { class: 'admonition-content' }, node.children),
      ],
    )

    parent.children[index] = admonition
  })
}
