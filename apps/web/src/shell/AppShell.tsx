import type { ComponentProps, ReactNode } from 'react';

import { SidebarInset, SidebarProvider, SidebarTrigger } from '../components/ui/sidebar.js';
import { TooltipProvider } from '../components/ui/tooltip.js';
import { AppSidebar } from './AppSidebar.js';
import { PageErrorBoundary } from './PageErrorBoundary.js';

export function AppShell({ pageId, headerActions, children, ...sidebar }: ComponentProps<typeof AppSidebar> & {
  readonly pageId: string;
  readonly headerActions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <AppSidebar {...sidebar} />
        <SidebarInset className="min-w-0">
          <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            {headerActions}
          </header>
          <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6" id={pageId}>
            {/* La clave reinicia el límite al cambiar de pantalla: el menú es la salida del error. */}
            <PageErrorBoundary key={pageId}>{children}</PageErrorBoundary>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
