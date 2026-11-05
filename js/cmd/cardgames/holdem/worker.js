import { decide } from './ai.js';
self.onmessage = ({ data }) => {
    try { self.postMessage({ id: data.id, action: decide(data.view) }); }
    catch { self.postMessage({ id: data.id, error: true }); }
};
