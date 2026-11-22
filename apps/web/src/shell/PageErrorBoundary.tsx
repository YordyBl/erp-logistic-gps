import { CircleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';

import { Button } from '../components/ui/button.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';

interface PageErrorBoundaryState {
  readonly failed: boolean;
}

/** Un fallo al dibujar una pantalla no debe dejar en blanco la app: la navegación sigue disponible. */
export class PageErrorBoundary extends Component<{ readonly children: ReactNode }, PageErrorBoundaryState> {
  override state: PageErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PageErrorBoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Empty role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CircleAlert aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>No se pudo mostrar esta pantalla</EmptyTitle>
          <EmptyDescription>Tus datos no cambiaron. Vuelve a intentarlo o abre otra sección del menú.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => this.setState({ failed: false })}>Reintentar</Button>
        </EmptyContent>
      </Empty>
    );
  }
}
