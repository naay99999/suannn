import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@workspace/ui/globals.css'
import { Toaster } from '@workspace/ui/components/toast'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { RouterProvider } from 'react-router'
import { useApiHealth } from './lib/api-health'
import { QueryProvider } from './lib/query-provider'
import { router } from './router'

function ApiHealthCheck() {
  useApiHealth()

  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <ApiHealthCheck />
      <Toaster>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </Toaster>
    </QueryProvider>
  </StrictMode>,
)
