import React from 'react';
import {createRoot} from 'react-dom/client';
import Platform from '../components/gd/platform';
import '../app/globals.css';
// After a deploy, an open tab may request a lazy chunk whose hashed file no longer exists; reload once to pick up the new build.
window.addEventListener('vite:preloadError',event=>{try{if(sessionStorage.getItem('gd-chunk-reload'))return;sessionStorage.setItem('gd-chunk-reload','1')}catch{return}event.preventDefault();location.reload()});
window.addEventListener('load',()=>setTimeout(()=>{try{sessionStorage.removeItem('gd-chunk-reload')}catch{}},10000));
createRoot(document.getElementById('root')!).render(<Platform/>);
