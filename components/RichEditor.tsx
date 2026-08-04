'use client'

import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import CaptionedImage from './CaptionedImage'
import { useCallback, useEffect, useRef, useState } from 'react'

// Rich-text body editor for the newsroom draft.
// Replaces the raw HTML textarea — journalists edit formatted prose, we still
// store HTML so /news/[slug] renders unchanged.

async function uploadImage(file: File): Promise<string> {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch('/api/newsroom/upload-image', { method: 'POST', body })
  let data: { url?: string; error?: string }
  try {
    data = await res.json()
  } catch {
    throw new Error(`Upload failed (HTTP ${res.status}) — no response body`)
  }
  if (!res.ok || data.error || !data.url) {
    throw new Error(data.error ?? `Upload failed (HTTP ${res.status})`)
  }
  return data.url
}

function Toolbar({ editor, onError }: { editor: Editor; onError: (m: string | null) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const pickImage = () => fileInput.current?.click()

  const handleFile = useCallback(async (file: File) => {
    setBusy(true); onError(null)
    try {
      const url = await uploadImage(file)
      const alt = window.prompt(
        'Alt text — describe the image for screen readers and search engines:',
        ''
      )
      const caption = window.prompt('Caption (optional) — shown beneath the image:', '')
      editor.chain().focus().setImage({
        src: url,
        alt: alt?.trim() || file.name,
        ...(caption?.trim() ? { caption: caption.trim() } : {}),
      }).run()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Image upload failed')
    } finally {
      setBusy(false)
    }
  }, [editor, onError])

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
      <button type="button" className="loro-rt-btn" onClick={pickImage} disabled={busy}
        title="Insert image (or drag one in)">{busy ? 'Uploading…' : 'Image'}</button>
      {editor.isActive('image') && (
        <>
          <button type="button" className="loro-rt-btn" title="Edit caption"
            onClick={() => {
              const current = (editor.getAttributes('image').caption as string) ?? ''
              const next = window.prompt('Caption — shown beneath the image:', current)
              if (next === null) return
              editor.chain().focus().updateAttributes('image', { caption: next.trim() || null }).run()
            }}>Caption</button>
          <button type="button" className="loro-rt-btn" title="Edit alt text (accessibility)"
            onClick={() => {
              const current = (editor.getAttributes('image').alt as string) ?? ''
              const next = window.prompt('Alt text — describe the image for screen readers:', current)
              if (next === null) return
              editor.chain().focus().updateAttributes('image', { alt: next.trim() || null }).run()
            }}>Alt</button>
        </>
      )}
      <input ref={fileInput} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
      <span className="loro-rt-sep" />
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
  const [uploadError, setUploadError] = useState<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      CaptionedImage.configure({ inline: false, allowBase64: false }),
    ],
    content: value || '<p></p>',
    // Must be false in the Next App Router: the default (true) renders the
    // editor during SSR, causing a hydration crash that took the whole draft
    // panel down (the "Open draft editor" button appeared to do nothing).
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'loro-rt-content',
        'data-placeholder': placeholder ?? 'Write the story…',
      },
      // Drag an image in, or paste one from the clipboard.
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files ?? [])
        const image = files.find(f => f.type.startsWith('image/'))
        if (!image) return false
        event.preventDefault()
        uploadImage(image)
          .then(url => {
            const { schema } = view.state
            const alt = window.prompt('Alt text — describe the image:', '') ?? ''
            const node = schema.nodes.image?.create({ src: url, alt: alt.trim() || image.name })
            if (!node) return
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            view.dispatch(view.state.tr.insert(pos ?? view.state.selection.from, node))
          })
          .catch(e => setUploadError(e instanceof Error ? e.message : 'Image upload failed'))
        return true
      },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? [])
        const image = files.find(f => f.type.startsWith('image/'))
        if (!image) return false
        event.preventDefault()
        uploadImage(image)
          .then(url => {
            const { schema } = view.state
            const alt = window.prompt('Alt text — describe the image:', '') ?? ''
            const node = schema.nodes.image?.create({ src: url, alt: alt.trim() || image.name })
            if (node) view.dispatch(view.state.tr.replaceSelectionWith(node))
          })
          .catch(e => setUploadError(e instanceof Error ? e.message : 'Image upload failed'))
        return true
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
      <Toolbar editor={editor} onError={setUploadError} />
      {uploadError && (
        <div className="loro-rt-error">
          {uploadError}
          <button type="button" onClick={() => setUploadError(null)}>Dismiss</button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
