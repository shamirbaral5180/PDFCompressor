import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { formatSize, uid } from './utils'

const A4_PORTRAIT = [595.28, 841.89]
const A4_LANDSCAPE = [841.89, 595.28]
const MARGINS = { none: 0, small: 20, medium: 40 }

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load: ' + file.name))
    img.src = URL.createObjectURL(file)
  })
}

export default function PdfImageMerge() {
  const [pdfs, setPdfs] = useState([])
  const [images, setImages] = useState([])
  const [orientation, setOrientation] = useState('portrait')
  const [marginSize, setMarginSize] = useState('none')
  const [outputPdf, setOutputPdf] = useState(null)
  const [outputSize, setOutputSize] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

  function movePdf(index, dir) {
    const next = [...pdfs]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setPdfs(next)
  }

  function removePdf(id) {
    setPdfs(prev => prev.filter(f => f.id !== id))
    setOutputPdf(null)
    setOutputSize(null)
  }

  function handleUploadPdf(e) {
    const selected = Array.from(e.target.files)
    for (const f of selected) {
      if (f.type !== 'application/pdf') {
        setError('Only PDF files are allowed')
        return
      }
    }
    setError('')
    setOutputPdf(null)
    setOutputSize(null)
    setPdfs(prev => [
      ...prev,
      ...selected.map(f => ({ id: uid(), file: f, name: f.name, size: f.size })),
    ])
  }

  function moveImage(index, dir) {
    const next = [...images]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setImages(next)
  }

  function removeImage(id) {
    setImages(prev => prev.filter(f => f.id !== id))
    setOutputPdf(null)
    setOutputSize(null)
  }

  async function handleUploadImage(e) {
    const selected = Array.from(e.target.files)
    setError('')
    setOutputPdf(null)
    setOutputSize(null)

    try {
      const loaded = await Promise.all(
        selected.map(async (f) => {
          if (!f.type.startsWith('image/')) throw new Error(f.name + ' is not an image')
          const img = await loadImageElement(f)
          return {
            id: uid(),
            file: f,
            name: f.name,
            size: f.size,
            thumbnailUrl: URL.createObjectURL(f),
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          }
        })
      )
      setImages(prev => [...prev, ...loaded])
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleMerge() {
    if (pdfs.length === 0 && images.length === 0) {
      setError('Add at least one PDF or image')
      return
    }

    setLoading(true)
    setError('')
    setProgress('')
    setOutputPdf(null)
    setOutputSize(null)

    try {
      const [pw, ph] = orientation === 'portrait' ? A4_PORTRAIT : A4_LANDSCAPE
      const margin = MARGINS[marginSize]
      const merged = await PDFDocument.create()
      let count = 0
      const total = pdfs.length + images.length

      for (const item of pdfs) {
        count++
        setProgress(`Processing PDF ${count}/${total}...`)

        const fd = new FormData()
        fd.append('pdf', item.file)
        fetch('upload.php', { method: 'POST', body: fd }).catch(() => {})

        const bytes = await item.file.arrayBuffer()
        const srcDoc = await PDFDocument.load(bytes)
        const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      }

      for (const item of images) {
        count++
        setProgress(`Processing image ${count}/${total}...`)

        const fd = new FormData()
        fd.append('image', item.file)
        fetch('upload.php', { method: 'POST', body: fd }).catch(() => {})

        const arrayBuffer = await item.file.arrayBuffer()
        let image
        const type = item.file.type

        if (type === 'image/jpeg' || type === 'image/jpg') {
          image = await merged.embedJpg(arrayBuffer)
        } else if (type === 'image/png') {
          image = await merged.embedPng(arrayBuffer)
        } else {
          const canvas = document.createElement('canvas')
          const img = await loadImageElement(item.file)
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
          const pngBytes = await blob.arrayBuffer()
          image = await merged.embedPng(pngBytes)
        }

        const iw = image.width
        const ih = image.height
        const aw = pw - 2 * margin
        const ah = ph - 2 * margin
        const s = Math.min(aw / iw, ah / ih)
        const sw = iw * s
        const sh = ih * s
        const dx = (pw - sw) / 2
        const dy = (ph - sh) / 2

        const page = merged.addPage([pw, ph])
        page.drawImage(image, { x: dx, y: dy, width: sw, height: sh })
      }

      const pdfBytes = await merged.save()
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      setOutputPdf(URL.createObjectURL(blob))
      setOutputSize(blob.size)
      setProgress('')
    } catch (err) {
      setError('Merge failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleDownload() {
    if (!outputPdf) return
    const a = document.createElement('a')
    a.href = outputPdf
    a.download = 'merged.pdf'
    a.click()
  }

  return (
    <div className="card">
      <h1>PDF &amp; Image Merger</h1>

      <div className="split-panels">
        <div className="panel">
          <h3>PDF Files</h3>
          <input
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={handleUploadPdf}
            id="merge-pdf-upload"
            hidden
          />
          <label htmlFor="merge-pdf-upload" className="upload-label panel-upload">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>Click to upload PDFs</span>
          </label>
          {pdfs.length > 0 && (
            <div className="file-list panel-list">
              {pdfs.map((f, i) => (
                <div key={f.id} className="file-row">
                  <div className="file-info">
                    <div className="file-name">{f.name}</div>
                    <div className="file-meta">{formatSize(f.size)}</div>
                  </div>
                  <div className="file-actions">
                    <button className="icon-btn" onClick={() => movePdf(i, -1)} disabled={i === 0} title="Move up">&uarr;</button>
                    <button className="icon-btn" onClick={() => movePdf(i, 1)} disabled={i === pdfs.length - 1} title="Move down">&darr;</button>
                    <button className="icon-btn danger" onClick={() => removePdf(f.id)} title="Remove">&times;</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {pdfs.length === 0 && <p className="panel-empty">No PDFs added</p>}
        </div>

        <div className="panel">
          <h3>Image Files</h3>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleUploadImage}
            id="merge-image-upload"
            hidden
          />
          <label htmlFor="merge-image-upload" className="upload-label panel-upload">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>Click to upload images</span>
          </label>
          {images.length > 0 && (
            <div className="file-list panel-list">
              {images.map((f, i) => (
                <div key={f.id} className="file-row">
                  <img src={f.thumbnailUrl} alt="" className="file-icon" style={{ objectFit: 'cover' }} />
                  <div className="file-info">
                    <div className="file-name">{f.name}</div>
                    <div className="file-meta">{formatSize(f.size)} &middot; {f.naturalWidth}&times;{f.naturalHeight}</div>
                  </div>
                  <div className="file-actions">
                    <button className="icon-btn" onClick={() => moveImage(i, -1)} disabled={i === 0} title="Move up">&uarr;</button>
                    <button className="icon-btn" onClick={() => moveImage(i, 1)} disabled={i === images.length - 1} title="Move down">&darr;</button>
                    <button className="icon-btn danger" onClick={() => removeImage(f.id)} title="Remove">&times;</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {images.length === 0 && <p className="panel-empty">No images added</p>}
        </div>
      </div>

      {(pdfs.length > 0 || images.length > 0) && (
        <div className="options">
          <div>
            <div className="label">Image Page Options</div>
            <div className="option-group" style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="file-meta">Orientation:</span>
                <div className="option-group">
                  <button className={`option-btn ${orientation === 'portrait' ? 'active' : ''}`} onClick={() => setOrientation('portrait')}>Portrait</button>
                  <button className={`option-btn ${orientation === 'landscape' ? 'active' : ''}`} onClick={() => setOrientation('landscape')}>Landscape</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="file-meta">Margins:</span>
                <div className="option-group">
                  <button className={`option-btn ${marginSize === 'none' ? 'active' : ''}`} onClick={() => setMarginSize('none')}>None</button>
                  <button className={`option-btn ${marginSize === 'small' ? 'active' : ''}`} onClick={() => setMarginSize('small')}>Small</button>
                  <button className={`option-btn ${marginSize === 'medium' ? 'active' : ''}`} onClick={() => setMarginSize('medium')}>Medium</button>
                </div>
              </div>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleMerge} disabled={loading}>
            {loading
              ? 'Merging...'
              : `Merge ${pdfs.length} PDF${pdfs.length !== 1 ? 's' : ''} + ${images.length} Image${images.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {progress && <div className="progress">{progress}</div>}
      {error && <div className="error">{error}</div>}

      {outputPdf && (
        <div className="result">
          <div className="result-header">
            <h2>Merged PDF</h2>
            <span className="size-badge">{formatSize(outputSize)}</span>
          </div>
          <iframe src={outputPdf} title="Merged PDF Preview" className="preview" />
          <button className="btn btn-primary download-btn" onClick={handleDownload}>
            Download Merged PDF
          </button>
        </div>
      )}
    </div>
  )
}
