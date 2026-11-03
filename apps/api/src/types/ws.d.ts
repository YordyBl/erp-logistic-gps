declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';

  export class WebSocket {
    static readonly OPEN: number;
    readonly readyState: number;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'message', listener: (data: Buffer) => void): this;
    send(data: string): void;
    close(code?: number, reason?: string): void;
  }

  export class WebSocketServer {
    readonly clients: Set<WebSocket>;
    constructor(options: {
      readonly noServer: true;
      readonly maxPayload?: number;
      readonly perMessageDeflate?: boolean;
    });
    on(event: 'connection', listener: (
      socket: WebSocket,
      request: IncomingMessage,
      identity: unknown,
    ) => void): this;
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer,
      callback: (socket: WebSocket) => void): void;
    emit(event: 'connection', socket: WebSocket, request: IncomingMessage,
      identity: unknown): boolean;
    close(callback?: () => void): void;
  }
}
