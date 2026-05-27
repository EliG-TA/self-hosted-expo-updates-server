import React, { PropsWithChildren, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useMount } from 'react-use'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import useForceUpdate from 'use-force-update'

import { Spinner, TopMenu } from './Components'
import { Background } from './Components/Layout/Background'
import { Notifications } from './Components/Layout/Notifications'
import AppPage from './Pages/App'
import Home from './Pages/Home'
import Login from './Pages/Login'
import NewApp from './Pages/NewApp'
import { FC, queryClient } from './Services'
import state, { jwtLogin } from './State'

import 'primereact/resources/themes/md-dark-indigo/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'

const RootContainer: React.FC<PropsWithChildren> = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>{children}</BrowserRouter>
  </QueryClientProvider>
)

function App() {
  const forceUpdate = useForceUpdate()
  const [isLoading, setIsLoading] = useState(true)

  useMount(async () => {
    state?.user?.state?.accessToken && (await jwtLogin())
    setIsLoading(false)
  })

  if (isLoading) return <Spinner />
  return (
    <RootContainer>
      <ReactQueryDevtools initialIsOpen={false} />

      <Background>
        <Notifications />
        {FC.authenticated && <TopMenu />}
        <div
          style={{
            height: '100%',
            overflowX: 'hidden',
            overflowY: 'auto',
            scrollbarWidth: 'none',
          }}>
          {!FC.authenticated ? (
            <Login handleLogin={() => forceUpdate()} />
          ) : (
            <Routes>
              <Route path="*" element={<Navigate to="/home" />} />
              <Route path="/home" element={<Home />} />
              <Route path="/new" element={<NewApp />} />
              <Route path="/app/:appId" element={<AppPage />} />
            </Routes>
          )}
        </div>
      </Background>
    </RootContainer>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
