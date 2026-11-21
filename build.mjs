// =====================================================================
// build.mjs — membuat 2 versi dari 1 sumber (folder src/):
//   1. apps-script/Index.html, CSS.html, JS.html  -> disalin ke editor Apps Script
//   2. docs/index.html + docs/assets/*            -> dipublikasikan via GitHub Pages
// Jalankan:  node build.mjs   (Node 18+, tanpa dependency)
// =====================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const write = (p, s) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); console.log('  ✓', p); };

const VERSION = '3.0.0';
const body = read('src/body.html');
const css = read('src/style.css');
const js = read('src/app.js');

if (body.includes('<?')) throw new Error('src/body.html tidak boleh berisi "<?" (bentrok dengan scriptlet Apps Script).');
if (js.includes('</script')) throw new Error('src/app.js tidak boleh berisi "</script".');

const favicon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpolygon points='32,2 58,17 58,47 32,62 6,47 6,17' fill='%23004e98'/%3E%3Cpath d='M20 40V26a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v14z' fill='%23ff6700'/%3E%3Crect x='18' y='40' width='28' height='4' rx='2' fill='%23ffffff'/%3E%3C/svg%3E";

// Tema diterapkan sedini mungkin agar tidak "berkedip".
const themeBoot = `<script>
    (function () {
      try {
        var t = localStorage.getItem('beecomp_theme');
        if (!t && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark';
        if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      } catch (e) {}
    })();
  </script>`;

const commonHead = (extra) => `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#004E98">
  <meta name="description" content="Antrian servis online BeeCOMP: ambil nomor antrian, pantau progres dengan kode akses, dan konsultasi dengan teknisi.">
  <title>BeeCOMP Service | Antri Servis Online</title>
  <link rel="icon" href="${favicon}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
${extra}
  ${themeBoot}`;

// ---------- 1. Apps Script ----------
console.log('Apps Script:');
write('apps-script/CSS.html', `<style>\n${css}\n</style>\n`);
write('apps-script/JS.html', `<script>\n${js}\n</script>\n`);
write('apps-script/Index.html', `<!DOCTYPE html>
<html lang="id">
<head>
  <base target="_top">
${commonHead("  <?!= include('CSS'); ?>")}
</head>
<body>
${body}
  <?!= include('JS'); ?>
</body>
</html>
`);

// ---------- 2. GitHub Pages ----------
console.log('GitHub Pages (docs/):');
write('docs/assets/style.css', css);
write('docs/assets/app.js', js);
write('docs/index.html', `<!DOCTYPE html>
<html lang="id">
<head>
${commonHead(`  <link rel="stylesheet" href="assets/style.css?v=${VERSION}">`)}
</head>
<body>
${body}
  <script src="config.js?v=${VERSION}"></script>
  <script src="assets/app.js?v=${VERSION}"></script>
</body>
</html>
`);
if (!existsSync(join(root, 'docs/config.js'))) {
  write('docs/config.js', `window.BEECOMP_CONFIG = {\n  GAS_URL: ''\n};\n`);
}
write('docs/.nojekyll', '');
write('docs/404.html', `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./"><title>Mengalihkan…</title></head><body><a href="./">Kembali ke beranda</a></body></html>\n`);
console.log('Selesai. Versi', VERSION);
