import Dashboard from './components/Dashboard'
import WebhookDebug from './components/WebhookDebug'

function App() {
  return (
    <div className="animated-bg min-h-screen">
      <Dashboard />
      <div className="max-w-7xl mx-auto px-8 pb-8">
        <WebhookDebug />
      </div>
    </div>
  )
}

export default App

