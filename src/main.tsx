import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadSaved } from './io/persist';
import { createSampleDocument } from './model/sample';
import { store } from './store/store';
import './styles/tokens.css';
import './styles/app.css';

async function start() {
  let saved = null;
  try {
    saved = await loadSaved();
  } catch {
    // O editor também funciona quando o navegador bloqueia o IndexedDB.
  }
  store.load(saved ?? createSampleDocument());
  document.documentElement.dataset.theme = store.state.ui.theme;
  createRoot(document.getElementById('root')!).render(<App />);
}

void start();
