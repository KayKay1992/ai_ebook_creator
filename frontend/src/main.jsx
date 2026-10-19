import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installGlobalErrorHandlers } from './utils/errorReporter.js'
import { registerServiceWorker } from './utils/registerServiceWorker.js'

// Report uncaught errors and unhandled rejections to the backend's error
// monitoring, and recover from stale chunks after a deploy.
installGlobalErrorHandlers()

// PWA service worker (offline reading); a browser refusing it is ignored.
if (import.meta.env.PROD) registerServiceWorker({ base: import.meta.env.BASE_URL })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      {/* Framer Motion skips movement for visitors who ask their system for
          reduced motion (opacity fades still run). */}
      <MotionConfig reducedMotion="user">
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        {/* Colours from theme variables (theme-dark.css), so toasts follow
            the reader's light/dark theme; admin stays light. */}
        <Toaster
          position='bottom-right'
          toastOptions={{ style: { background: 'var(--toast-bg)', color: 'var(--toast-fg)', border: '1px solid var(--toast-border)' } }}
        />
      </AuthProvider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
)
