import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The tablet fetches one page with no follow-up asset requests, so nothing but
// `GET /` has to carry the token gate.
export default defineConfig({ plugins: [react(), viteSingleFile()] });
