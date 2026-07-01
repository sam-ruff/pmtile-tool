import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/noto-sans/400.css'
import '@fontsource/noto-sans/500.css'
import '@fontsource/noto-sans/600.css'
import './style.css'
import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')
