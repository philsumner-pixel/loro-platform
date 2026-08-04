import Image from '@tiptap/extension-image'

// Image with a caption and alt text, rendered as semantic markup:
//   <figure><img src alt /><figcaption>…</figcaption></figure>
//
// Alt text is required for accessibility and is read by search and answer
// engines; the caption is editorial. Both are stored on the node so they
// survive the HTML round-trip into loro_articles.body_html.

export const CaptionedImage = Image.extend({
  name: 'image',

  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: null,
        parseHTML: element => {
          // When re-parsing stored HTML the caption lives on the sibling
          // <figcaption>, not the <img> itself.
          const fig = element.closest('figure')
          return fig?.querySelector('figcaption')?.textContent?.trim() || null
        },
        renderHTML: () => ({}), // not an <img> attribute
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'figure img[src]' },
      { tag: 'img[src]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const { caption, ...imgAttrs } = HTMLAttributes as Record<string, unknown> & { caption?: string }

    if (!caption) {
      return ['img', imgAttrs]
    }

    return [
      'figure',
      { class: 'loro-figure' },
      ['img', imgAttrs],
      ['figcaption', {}, caption],
    ]
  },
})

export default CaptionedImage
