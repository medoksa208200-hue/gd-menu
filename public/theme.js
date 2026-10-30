// Applies the saved or system theme before first paint (external file: the CSP forbids inline scripts).
(function(){var t;try{t=localStorage.getItem('gd-theme')}catch(e){}if(t!=='light'&&t!=='dark')t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t)})();
