import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { formatSize, uid } from './utils'

export default function PdfMerger() {
  const [files, setFiles] = useState([])
  const [mergedPdf, setMergedPdf] = useState(null)
  const [mergedSize, setMergedSize] = useState(null)
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
    setMergedPdf(null)
    setMergedSize(null)
  }

  function handleUpload(e) {
    const selected = Array.from(e.target.files)
    for (const f of selected) {
      if (f.type !== 'application/pdf') {
        setError('Only PDF files are allowed')
        return
      }
    }
    setError('')
    setMergedPdf(null)
    setMergedSize(null)
    setFiles(prev => [
      ...prev,
      ...selected.map(f => ({ id: uid(), file: f, name: f.name, size: f.size })),
    ])
  }

  async function handleMerge() {
    if (files.length < 2) {
      setError('Please add at least 2 PDF files')
      return
    }

    setLoading(true)
    setError('')
    setProgress('')
    setMergedPdf(null)
    setMergedSize(null)

    try {
      const merged = await PDFDocument.create()

      for (let i = 0; i < files.length; i++) {
        setProgress(`Processing ${files[i].name} (${i + 1}/${files.length})...`)

        const fd = new FormData()
        fd.append('pdf', files[i].file)
        fetch('upload.php', { method: 'POST', body: fd }).catch(() => {})

        const bytes = await files[i].file.arrayBuffer()
        const srcDoc = await PDFDocument.load(bytes)
        const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      }

      const pdfBytes = await merged.save()
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      setMergedPdf(URL.createObjectURL(blob))
      setMergedSize(blob.size)
      setProgress('')
    } catch (err) {
      setError('Merge failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleDownload() {
    if (!mergedPdf) return
    const a = document.createElement('a')
    a.href = mergedPdf
    a.download = 'merged.pdf'
    a.click()
  }

  return (
    <div className="card">
      <h1>PDF Merger</h1>

      <div className="upload-area">
        <input
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={handleUpload}
          id="merger-upload"
          hidden
        />
        <label htmlFor="merger-upload" className="upload-label">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>Click to upload PDF files</span>
        </label>
      </div>

      {files.length > 0 && (
        <div className="file-list">
          {files.map((f, i) => (
            <div key={f.id} className="file-row">
              <div className="file-info">
                <div className="file-name">{f.name}</div>
                <div className="file-meta">{formatSize(f.size)}</div>
              </div>
              <div className="file-actions">
                <button className="icon-btn" onClick={() => moveFile(i, -1)} disabled={i === 0} title="Move up">↑</button>
                <button className="icon-btn" onClick={() => moveFile(i, 1)} disabled={i === files.length - 1} title="Move down">↓</button>
                <button className="icon-btn danger" onClick={() => removeFile(f.id)} title="Remove">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {files.length >= 2 && (
        <button className="btn btn-primary" onClick={handleMerge} disabled={loading}>
          {loading ? 'Merging...' : `Merge ${files.length} PDFs`}
        </button>
      )}

      {files.length === 1 && (
        <p className="empty-state">Add at least 1 more PDF to merge</p>
      )}

      {progress && <div className="progress">{progress}</div>}
      {error && <div className="error">{error}</div>}

      {mergedPdf && (
        <div className="result">
          <div className="result-header">
            <h2>Merged PDF</h2>
            <span className="size-badge">{formatSize(mergedSize)}</span>
          </div>
          <iframe src={mergedPdf} title="Merged PDF Preview" className="preview" />
          <button className="btn btn-primary download-btn" onClick={handleDownload}>
            Download Merged PDF
          </button>
        </div>
      )}
    </div>
  )
}
