import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { ConfirmProvider } from './components/ConfirmProvider'
import { ThemeProvider } from './components/ThemeProvider'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { AdminLayout } from './layouts/AdminLayout'
import { DeploysPage } from './pages/DeploysPage'
import { LoginPage } from './pages/LoginPage'
import { NodesPage } from './pages/NodesPage'
import { ObservabilityPage } from './pages/ObservabilityPage'
import { OverviewPage } from './pages/OverviewPage'
import { ServiceLogsPage } from './pages/ServiceLogsPage'
import { ServicesPage } from './pages/ServicesPage'
import { SharedPage } from './pages/SharedPage'

export default function AppRoot() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <ConfirmProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<RequireAuth />}>
                  <Route element={<AdminLayout />}>
                    <Route index element={<OverviewPage />} />
                    <Route path="shared" element={<SharedPage />} />
                    <Route path="services" element={<ServicesPage />} />
                    <Route path="nodes" element={<NodesPage />} />
                    <Route path="deploys" element={<DeploysPage />} />
                    <Route path="observability" element={<ObservabilityPage />} />
                    <Route path="service-logs" element={<ServiceLogsPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
          <Toaster />
        </ConfirmProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
