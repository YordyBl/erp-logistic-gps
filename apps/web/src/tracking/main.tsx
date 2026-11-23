import React from 'react';
import ReactDOM from 'react-dom/client';

import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import '../styles.css';
import { readTrackingKey, TrackingPage } from './TrackingPage.js';

/**
 * Public tracking entry (/seguimiento). It is its own Vite input, so the recipient
 * never downloads the ERP bundle.
 */
function Root() {
  const [key, setKey] = React.useState(() => readTrackingKey(window.location.hash));
  React.useEffect(() => {
    const onHash = () => setKey(readTrackingKey(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return <TrackingPage key={key} trackingKey={key} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
