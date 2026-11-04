// Publishes a new Android rep app: bumps the version, builds the site and the APK, and writes
// public/downloads/version.json so installed apps show the "update available" banner.
//   node scripts/release-android.mjs "What changed" [--required]
// Requires the two VITE_ variables, ANDROID_HOME and a JDK. Sign every release with the same key, or Android
// refuses to install it over the previous version.
import {readFileSync,writeFileSync,copyFileSync,rmSync,mkdirSync} from 'node:fs';
import {execSync} from 'node:child_process';

const notes=process.argv.slice(2).filter(a=>!a.startsWith('--')).join(' ').trim();
const required=process.argv.includes('--required');
const gradlePath='android/app/build.gradle';
let gradle=readFileSync(gradlePath,'utf8');
const code=Number(gradle.match(/versionCode\s+(\d+)/)[1])+1;
const [major,minor]=gradle.match(/versionName\s+"(\d+)\.(\d+)/).slice(1).map(Number);
const name=`${major}.${minor+1}`;
gradle=gradle.replace(/versionCode\s+\d+/,`versionCode ${code}`).replace(/versionName\s+"[^"]+"/,`versionName "${name}"`);
writeFileSync(gradlePath,gradle);

const run=(cmd,cwd='.')=>execSync(cmd,{cwd,stdio:'inherit'});
run('pnpm exec vite build --config vite.pages.config.ts');
rmSync('dist-pages/downloads',{recursive:true,force:true}); // never ship the previous APK inside the new one
run('pnpm exec cap sync android');
run(process.platform==='win32'?'gradlew.bat assembleDebug':'./gradlew assembleDebug','android');
mkdirSync('public/downloads',{recursive:true});
copyFileSync('android/app/build/outputs/apk/debug/app-debug.apk','public/downloads/gd-rep.apk');
const release={versionCode:code,versionName:name,url:'/downloads/gd-rep.apk',notes:notes||undefined,publishedAt:new Date().toISOString(),...(required?{minVersionCode:code}:{})};
writeFileSync('public/downloads/version.json',JSON.stringify(release,null,2)+'\n');
console.log(`Released ${name} (${code}). Commit android/app/build.gradle and public/downloads, then deploy.`);
