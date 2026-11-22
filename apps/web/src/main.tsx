import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
