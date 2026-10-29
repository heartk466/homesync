import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/searchBar.css'
import './styles/icons.css'
import './global-dark.css'         
import App from './App.jsx'
import { AppProvider } from './AppContext'  

// The app is laid out for the phone screen: block page pinch-zoom (iOS ignores
// user-scalable=no, so also cancel its gesture events). The proof / chat photo
// viewer still zooms — it handles pinch itself with pointer events.
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('gesturechange', (e) => e.preventDefault())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>          
      <App />
    </AppProvider>         
  </StrictMode>,
)