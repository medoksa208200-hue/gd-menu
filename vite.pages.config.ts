import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({root:'pages',server:{host:'0.0.0.0',allowedHosts:['terminal.local']},envDir:process.cwd(),publicDir:'../public',plugins:[react(),tailwindcss()],resolve:{alias:{'@':path.resolve(process.cwd())}},build:{outDir:'../dist-pages',emptyOutDir:true,chunkSizeWarningLimit:1100}});
