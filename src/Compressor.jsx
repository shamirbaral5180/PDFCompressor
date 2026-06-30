import { useState, useRef } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'

const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
GlobalWorkerOptions.workerSrc = WORKER

const Q_MIN = 0.08
const Q_MAX = 0.92
const DPI_MIN = 50
const DPI_MAX = 400
const INITIAL_DPI = 200

function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function parseSizeInput(value, unit) {
  const v = parseFloat(value)
  if (isNaN(v) || v <= 0) return 0
  return unit === 'MB' ? v * 1024 * 1024 : v * 1024
}

export default function Compressor() {
  const [file, setFile] = useState(null)
  const [targetValue, setTargetValue] = useState('500')
  const [targetUnit, setTargetUnit] = useState('KB')
  const [compressedPdf, setCompressedPdf] = useState(null)
  const [compressedSize, setCompressedSize] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [log, setLog] = useState([])
  const inputRef = useRef(null)

  function addLog(msg) {
    setLog(prev => [...prev, msg])
  }

  function handleFileChange(e) {
    const selected = e.target.files[0]
    if (!selected) return
    if (selected.type !== 'application/pdf') {
      setError('Only PDF files are allowed')
      setFile(null)
      return
    }
    setError('')
    setFile(selected)
    setCompressedPdf(null)
    setCompressedSize(null)
    setLog([])
  }

  async function renderPage(page, scale) {
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas
  }

  async function jpegBlobSize(canvas, quality) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob.size
  }

  async function renderAllPages(pdf, scale, onProgress) {
    const total = pdf.numPages
    const canvases = []
    for (let i = 1; i <= total; i++) {
      if (onProgress) onProgress(`Rendering page ${i}/${total}...`)
      const page = await pdf.getPage(i)
      const canvas = await renderPage(page, scale)
      canvases.push(canvas)
    }
    return canvases
  }

  function totalSizeAtQuality(canvases, quality) {
    return Promise.all(canvases.map(c => jpegBlobSize(c, quality)))
  }

  async function buildFinalPdf(pdf, canvases, quality, scale, onProgress) {
    if (onProgress) onProgress('Building compressed PDF...')
    const newPdf = await PDFDocument.create()

    for (let i = 0; i < canvases.length; i++) {
      if (onProgress) onProgress(`Encoding page ${i + 1}/${canvases.length}...`)
      const blob = await new Promise(resolve => canvases[i].toBlob(resolve, 'image/jpeg', quality))
      const imageBytes = await blob.arrayBuffer()
      const image = await newPdf.embedJpg(imageBytes)

      const origPage = await pdf.getPage(i + 1)
      const origViewport = origPage.getViewport({ scale: 1 })
      const ptW = origViewport.width
      const ptH = origViewport.height
      const page = newPdf.addPage([ptW, ptH])
      page.drawImage(image, { x: 0, y: 0, width: ptW, height: ptH })
    }

    const pdfBytes = await newPdf.save({ useObjectStreams: true })
    return new Blob([pdfBytes], { type: 'application/pdf' })
  }

  async function handleCompress() {
    if (!file) return
    const targetBytes = parseSizeInput(targetValue, targetUnit)
    if (targetBytes <= 0) {
      setError('Enter a valid target size')
      return
    }

    setLoading(true)
    setError('')
    setLog([])
    setCompressedPdf(null)
    setCompressedSize(null)

    try {
      const formData = new FormData()
      formData.append('pdf', file)
      fetch('upload.php', { method: 'POST', body: formData }).catch(() => {})

      const arrayBuffer = await file.arrayBuffer()
      const pdf = await getDocument({ data: arrayBuffer }).promise
      const numPages = pdf.numPages
      addLog(`Loaded ${numPages} page(s) | Source: ${formatSize(file.size)} | Target: ${formatSize(targetBytes)}`)

      if (file.size <= targetBytes) {
        addLog('File is already at or below target — returning original.')
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' })
        setCompressedPdf(URL.createObjectURL(blob))
        setCompressedSize(blob.size)
        pdf.destroy()
        setLoading(false)
        return
      }

      let finalBlob = null
      let canvases = null
      let dpi = INITIAL_DPI

      for (let pass = 0; pass < 3; pass++) {
        const isLast = pass === 2
        addLog(`\nPass ${pass + 1}: rendering at ${dpi} DPI`)
        const scale = dpi / 72
        canvases = await renderAllPages(pdf, scale, msg => setProgress(msg))

        const sizesAtMid = await totalSizeAtQuality(canvases, 0.5)
        const midSize = sizesAtMid.reduce((a, b) => a + b, 0)
        addLog(`  At q=0.50 → ${formatSize(midSize)}`)

        if (Math.abs(1 - targetBytes / midSize) <= 0.12) {
          addLog('  Close enough at q=0.50 — done.')
          finalBlob = await buildFinalPdf(pdf, canvases, 0.5, scale, msg => setProgress(msg))
          break
        }

        async function bestQualityInRange(loQ, hiQ) {
          let l = loQ, h = hiQ
          for (let i = 0; i < 8; i++) {
            const q = (l + h) / 2
            const sizes = await totalSizeAtQuality(canvases, q)
            const total = sizes.reduce((a, b) => a + b, 0)
            if (Math.abs(1 - targetBytes / total) <= 0.08) {
              return { q, total }
            }
            if (total > targetBytes) h = q; else l = q
          }
          return { q: (l + h) / 2, total: null }
        }

        let lo = Q_MIN, hi = Q_MAX

        if (midSize > targetBytes) {
          const sizesAtLo = await totalSizeAtQuality(canvases, Q_MIN)
          const loSize = sizesAtLo.reduce((a, b) => a + b, 0)
          addLog(`  At q=${Q_MIN.toFixed(2)} → ${formatSize(loSize)}`)

          if (loSize > targetBytes) {
            if (!isLast) {
              dpi = Math.round(Math.max(DPI_MIN, dpi * Math.sqrt(targetBytes / loSize)))
              addLog(`  Too big at min quality → reducing DPI to ${dpi}`)
              continue
            }
            addLog(`  Last pass — accepting min quality result (${formatSize(loSize)})`)
            finalBlob = await buildFinalPdf(pdf, canvases, Q_MIN, scale, msg => setProgress(msg))
            break
          }

          const result = await bestQualityInRange(Q_MIN, 0.5)
          const total = result.total ?? (await totalSizeAtQuality(canvases, result.q)).reduce((a, b) => a + b, 0)
          addLog(`  Binary search: q=${result.q.toFixed(3)} → ${formatSize(total)}`)
          finalBlob = await buildFinalPdf(pdf, canvases, result.q, scale, msg => setProgress(msg))
          break
        } else {
          const sizesAtHi = await totalSizeAtQuality(canvases, Q_MAX)
          const hiSize = sizesAtHi.reduce((a, b) => a + b, 0)
          addLog(`  At q=${Q_MAX.toFixed(2)} → ${formatSize(hiSize)}`)

          if (hiSize < targetBytes) {
            if (!isLast) {
              dpi = Math.round(Math.min(DPI_MAX, dpi * Math.sqrt(targetBytes / hiSize)))
              addLog(`  Too small at max quality → increasing DPI to ${dpi}`)
              continue
            }
            addLog(`  Last pass — accepting max quality result (${formatSize(hiSize)})`)
            finalBlob = await buildFinalPdf(pdf, canvases, Q_MAX, scale, msg => setProgress(msg))
            break
          }

          const result = await bestQualityInRange(0.5, Q_MAX)
          const total = result.total ?? (await totalSizeAtQuality(canvases, result.q)).reduce((a, b) => a + b, 0)
          addLog(`  Binary search: q=${result.q.toFixed(3)} → ${formatSize(total)}`)
          finalBlob = await buildFinalPdf(pdf, canvases, result.q, scale, msg => setProgress(msg))
          break
        }
      }

      addLog(`\nTarget: ${formatSize(targetBytes)} | Result: ${formatSize(finalBlob.size)} (${Math.round((1 - finalBlob.size / file.size) * 100)}% reduction)`)

      pdf.destroy()
      setCompressedPdf(URL.createObjectURL(finalBlob))
      setCompressedSize(finalBlob.size)
      setProgress('')
    } catch (err) {
      setError('Compression failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleDownload() {
    if (!compressedPdf) return
    const a = document.createElement('a')
    a.href = compressedPdf
    a.download = 'compressed_' + (file?.name || 'output.pdf')
    a.click()
  }

  function handleReset() {
    setFile(null)
    setCompressedPdf(null)
    setCompressedSize(null)
    setError('')
    setProgress('')
    setLog([])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="card">
      <h1>PDF Compressor</h1>

      <div className="upload-area">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
          id="pdf-upload"
          hidden
        />
        <label htmlFor="pdf-upload" className="upload-label">
          {file ? (
            <span className="file-name">{file.name} ({formatSize(file.size)})</span>
          ) : (
            <>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Click to upload a PDF file</span>
            </>
          )}
        </label>
        {file && (
          <button className="btn btn-outline" onClick={handleReset}>Remove</button>
        )}
      </div>

      {file && (
        <div className="options">
          <label className="label">Target Output Size</label>
          <div className="size-input-row">
            <input
              type="number"
              className="size-input"
              value={targetValue}
              onChange={e => setTargetValue(e.target.value)}
              min="1"
              placeholder="Size"
            />
            <select
              className="size-unit"
              value={targetUnit}
              onChange={e => setTargetUnit(e.target.value)}
            >
              <option value="KB">KB</option>
              <option value="MB">MB</option>
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleCompress}
            disabled={loading}
          >
            {loading ? 'Compressing...' : 'Compress PDF'}
          </button>
        </div>
      )}

      {progress && <div className="progress">{progress}</div>}

      {error && <div className="error">{error}</div>}

      {log.length > 0 && (
        <div className="log">
          {log.map((line, i) => (
            <div key={i} className={`log-line ${line.startsWith('Pass') || line.startsWith('Target') ? 'log-bold' : ''}`}>{line}</div>
          ))}
        </div>
      )}

      {compressedPdf && (
        <div className="result">
          <div className="result-header">
            <h2>Compressed PDF</h2>
            <span className="size-badge">
              {formatSize(compressedSize)} (target: {targetValue} {targetUnit})
            </span>
          </div>
          <iframe src={compressedPdf} title="Compressed PDF Preview" className="preview" />
          <button className="btn btn-primary download-btn" onClick={handleDownload}>
            Download Compressed PDF
          </button>
        </div>
      )}
    </div>
  )
}
