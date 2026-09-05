import { App, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { AdminLayout } from './layouts/AdminLayout'
import { LoginPage } from './pages/LoginPage'
import { NodesPage } from './pages/NodesPage'
import { OverviewPage } from './pages/OverviewPage'
import { DeploysPage } from './pages/DeploysPage'
import { ServicesPage } from './pages/ServicesPage'
import { SharedPage } from './pages/SharedPage'
import { themeConfig } from './theme'

export default function AppRoot() {
  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <App className="h-full">
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
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </App>
    </ConfigProvider>
  )
}
