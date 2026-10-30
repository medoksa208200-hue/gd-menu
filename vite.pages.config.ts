import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
// Stable vendor chunks keep their hashed filenames across app deploys, so returning visitors reuse them from cache.
const vendors=[{name:'react',test:/node_modules[\\/](react|react-dom|scheduler)[\\/]/},{name:'supabase',test:/node_modules[\\/]@supabase[\\/]/},{name:'charts',test:/node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|@reduxjs|redux|immer|reselect|es-toolkit)[\\/]/}];
export default defineConfig({root:'pages',server:{host:'0.0.0.0',allowedHosts:['terminal.local']},envDir:process.cwd(),publicDir:'../public',plugins:[react(),tailwindcss()],resolve:{alias:{'@':path.resolve(process.cwd())}},build:{outDir:'../dist-pages',emptyOutDir:true,target:'es2022',sourcemap:false,modulePreload:{polyfill:false},chunkSizeWarningLimit:1000,rolldownOptions:{output:{codeSplitting:{groups:vendors}}}}});
