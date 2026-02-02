import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ToastProvider, CursorGlow } from './components/ui'
import CommandPalette from './components/ui/CommandPalette'

// Remove preloader
const preloader = document.querySelector('.preloader')
if (preloader) {
  preloader.remove()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      {/* Aurora background */}
      <div className="aurora-bg" />
      
      {/* Cursor glow effect */}
      <CursorGlow />
      
      {/* Main app */}
      <App />
      
      {/* Command palette - available everywhere */}
      <CommandPalette commands={[]} />
    </ToastProvider>
  </StrictMode>,
)
