import { useState } from 'react'
import Compressor from './Compressor'
import PdfMerger from './PdfMerger'
import ImageToPdf from './ImageToPdf'
import './App.css'

export default function App() {
  const [service, setService] = useState('compressor')

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">PDF Tools</h1>
        <nav className="nav">
          <button
            className={'nav-tab' + (service === 'compressor' ? ' active' : '')}
            onClick={() => setService('compressor')}
          >
            Compressor
          </button>
          <button
            className={'nav-tab' + (service === 'merger' ? ' active' : '')}
            onClick={() => setService('merger')}
          >
            PDF Merger
          </button>
          <button
            className={'nav-tab' + (service === 'imageToPdf' ? ' active' : '')}
            onClick={() => setService('imageToPdf')}
          >
            Image to PDF
          </button>
        </nav>
      </header>
      <main className="container">
        {service === 'compressor' && <Compressor />}
        {service === 'merger' && <PdfMerger />}
        {service === 'imageToPdf' && <ImageToPdf />}
      </main>
    </div>
  )
}
