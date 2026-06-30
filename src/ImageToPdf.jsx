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

export default function ImageToPdf() {
  const [files, setFiles] = useState([])
  const [orientation, setOrientation] = useState('portrait')
  const [marginSize, setMarginSize] = useState('none')
  const [outputPdf, setOutputPdf] = useState(null)
  const [outputSize, setOutputSize] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

  function moveFile(index, dir) {
    const next = [...files]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setFiles(next)
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id))
    setOutputPdf(null)
    setOutputSize(null)
  }

  async function handleUpload(e) {
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
      setFiles(prev => [...prev, ...loaded])
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleConvert() {
    if (files.length === 0) {
      setError('Please add at least 1 image')
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
      const pdfDoc = await PDFDocument.create()

      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgress(`Processing ${f.name} (${i + 1}/${files.length})...`)

        const fd = new FormData()
        fd.append('image', f.file)
        fetch('upload.php', { method: 'POST', body: fd }).catch(() => {})

        const arrayBuffer = await f.file.arrayBuffer()
        let image
        const type = f.file.type

        if (type === 'image/jpeg' || type === 'image/jpg') {
          image = await pdfDoc.embedJpg(arrayBuffer)
        } else if (type === 'image/png') {
          image = await pdfDoc.embedPng(arrayBuffer)
        } else {
          const canvas = document.createElement('canvas')
          const img = await loadImageElement(f.file)
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
          const pngBytes = await blob.arrayBuffer()
          image = await pdfDoc.embedPng(pngBytes)
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

        const page = pdfDoc.addPage([pw, ph])
        page.drawImage(image, { x: dx, y: dy, width: sw, height: sh })
      }

      const pdfBytes = await pdfDoc.save()
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      setOutputPdf(URL.createObjectURL(blob))
      setOutputSize(blob.size)
      setProgress('')
    } catch (err) {
      setError('Conversion failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleDownload() {
    if (!outputPdf) return
    const a = document.createElement('a')
    a.href = outputPdf
    a.download = 'images.pdf'
    a.click()
  }

  return (
    <div className="card">
      <h1>Image to PDF</h1>

      <div className="upload-area">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleUpload}
          id="image-upload"
          hidden
        />
        <label htmlFor="image-upload" className="upload-label">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span>Click to upload images</span>
        </label>
      </div>

      {files.length > 0 && (
        <>
          <div className="options">
            <div>
              <div className="label">Page Size</div>
              <p className="file-meta" style={{ marginTop: 2 }}>A4 ({orientation === 'portrait' ? '210 × 297 mm' : '297 × 210 mm'})</p>
            </div>
            <div>
              <div className="label">Orientation</div>
              <div className="option-group">
                <button className={`option-btn ${orientation === 'portrait' ? 'active' : ''}`} onClick={() => setOrientation('portrait')}>Portrait</button>
                <button className={`option-btn ${orientation === 'landscape' ? 'active' : ''}`} onClick={() => setOrientation('landscape')}>Landscape</button>
              </div>
            </div>
            <div>
              <div className="label">Margins</div>
              <div className="option-group">
                <button className={`option-btn ${marginSize === 'none' ? 'active' : ''}`} onClick={() => setMarginSize('none')}>None</button>
                <button className={`option-btn ${marginSize === 'small' ? 'active' : ''}`} onClick={() => setMarginSize('small')}>Small</button>
                <button className={`option-btn ${marginSize === 'medium' ? 'active' : ''}`} onClick={() => setMarginSize('medium')}>Medium</button>
              </div>
            </div>
          </div>

          <div className="file-list">
            {files.map((f, i) => (
              <div key={f.id} className="file-row">
                <img src={f.thumbnailUrl} alt="" className="file-icon" style={{ objectFit: 'cover' }} />
                <div className="file-info">
                  <div className="file-name">{f.name}</div>
                  <div className="file-meta">{formatSize(f.size)} &middot; {f.naturalWidth}&times;{f.naturalHeight}</div>
                </div>
                <div className="file-actions">
                  <button className="icon-btn" onClick={() => moveFile(i, -1)} disabled={i === 0} title="Move up">&uarr;</button>
                  <button className="icon-btn" onClick={() => moveFile(i, 1)} disabled={i === files.length - 1} title="Move down">&darr;</button>
                  <button className="icon-btn danger" onClick={() => removeFile(f.id)} title="Remove">&times;</button>
                </div>
              </div>
            ))}
          </div>

          <button className="btn btn-primary" onClick={handleConvert} disabled={loading}>
            {loading ? 'Converting...' : `Convert ${files.length} Image${files.length > 1 ? 's' : ''} to PDF`}
          </button>
        </>
      )}

      {progress && <div className="progress">{progress}</div>}
      {error && <div className="error">{error}</div>}

      {outputPdf && (
        <div className="result">
          <div className="result-header">
            <h2>Generated PDF</h2>
            <span className="size-badge">{formatSize(outputSize)}</span>
          </div>
          <iframe src={outputPdf} title="Generated PDF Preview" className="preview" />
          <button className="btn btn-primary download-btn" onClick={handleDownload}>
            Download PDF
          </button>
        </div>
      )}
    </div>
  )
}
