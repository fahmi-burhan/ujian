// client/src/main.ts — titik masuk JavaScript di browser.
// Dipanggil oleh: client/index.html.
// Memanggil: Vue (membuat aplikasi), router (daftar halaman), App.vue, CSS Tailwind/daisyUI, CSS Font Awesome.
// Font Awesome diimpor dari npm (bukan CDN), jadi ikut dibundel Vite dan tidak bergantung pada
// server pihak ketiga. Hanya set "solid" yang dimuat agar ukuran unduhan tetap kecil.
import { createApp } from 'vue';
import '@fortawesome/fontawesome-free/css/fontawesome.css';
import '@fortawesome/fontawesome-free/css/solid.css';
import './styles.css';
import App from './App.vue';
import { router } from './router.ts';

createApp(App).use(router).mount('#app');
