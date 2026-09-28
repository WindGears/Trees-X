import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import 'lenis/dist/lenis.css'
import './assets/styles/main.css'
import './assets/styles/gesture.css'
import './assets/styles/experience.css'
import './assets/styles/collection.css'
import './assets/styles/speaker.css'

createApp(App).use(createPinia()).mount('#app')
