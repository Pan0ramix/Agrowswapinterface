import Loader from 'components/Icons/LoadingSpinner'
import { RouteDefinition, routes, useRouterConfig } from 'pages/RouteDefinitions'
import { memo, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { createLazy } from 'utils/lazyWithRetry'

// The Chrome is always loaded, but is lazy-loaded because it is not needed without user interaction.
// Using createLazy with retry to handle dynamic import failures (e.g., HMR issues, deployment changes)
const AppChrome = createLazy(() => import(/* webpackPreload: true */ './Chrome'))

export const Body = memo(function Body({ shouldRenderAppChrome = true }: { shouldRenderAppChrome?: boolean }) {
  const routerConfig = useRouterConfig()

  return (
    <>
      {shouldRenderAppChrome ? (
        <Suspense>
          <AppChrome />
        </Suspense>
      ) : null}

      <Suspense fallback={<Loader />}>
        <Routes>
          {routes.map((route: RouteDefinition) =>
            route.enabled(routerConfig) ? (
              <Route key={route.path} path={route.path} element={route.getElement(routerConfig)}>
                {route.nestedPaths.map((nestedPath) => (
                  <Route
                    path={nestedPath}
                    element={route.getElement(routerConfig)}
                    key={`${route.path}/${nestedPath}`}
                  />
                ))}
              </Route>
            ) : null,
          )}
        </Routes>
      </Suspense>
    </>
  )
})
