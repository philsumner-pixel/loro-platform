'use client'

import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useCallback, useEffect } from 'react'

// Rich-text body editor for the newsroom draft.
// Replaces the raw HTML textarea — journalists edit formatted prose, we still
// store HTML so /news/[slug] renders unchanged.

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = useCallback(() => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const btn = (active: boolean) => `loro-rt-btn${active ? ' active' : ''}`

  return (
    <div className="loro-rt-toolbar">
      <button type="button" className={btn(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><b>B</b></button>
      <button type="button" className={btn(editor.isActive('italic'))}
        onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><i>I</i></button>
      <span className="loro-rt-sep" />
      <button type="button" className={btn(editor.isActive('heading', { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Subheading">H2</button>
      <button type="button" className={btn(editor.isActive('heading', { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Small heading">H3</button>
      <span className="loro-rt-sep" />
      <button type="button" className={btn(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">• List</button>
      <button type="button" className={btn(editor.isActive('blockquote'))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Pull quote">&ldquo; Quote</button>
      <span className="loro-rt-sep" />
      <button type="button" className={btn(editor.isActive('link'))}
        onClick={setLink} title="Add link">Link</button>
      <button type="button" className="loro-rt-btn"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Clear formatting">Clear</button>
      <span className="loro-rt-count">
        {editor.getText().split(/\s+/).filter(Boolean).length} words
      </span>
    </div>
  )
}

export default function RichEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class: 'loro-rt-content',
        'data-placeholder': placeholder ?? 'Write the story…',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Keep the editor in sync when the draft is replaced (e.g. a new candidate
  // is opened, or a freshly generated brief is applied).
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (value !== current) {
      editor.commands.setContent(value || '<p></p>', false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  if (!editor) return <div className="loro-rt-loading">Loading editor…</div>

  return (
    <div className="loro-rt">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
