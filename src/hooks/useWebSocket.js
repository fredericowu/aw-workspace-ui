import { useEffect, useRef, useCallback, useState } from 'react';
import { wsUrl } from '../auth';

export function useWebSocket(key, onMessage) {
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const [connected, setConnected] = useState(false);
  const reconnectTimeout = useRef(null);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!key) return;

    const connect = () => {
      const ws = new WebSocket(wsUrl(`/ws/logs/${key}`));
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        if (onMessageRef.current) onMessageRef.current(event.data);
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimeout.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [key]);

  const close = useCallback(() => {
    if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  return { connected, close };
}
