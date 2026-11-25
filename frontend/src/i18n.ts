import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import sv from './locales/sv.json'

const language = localStorage.getItem('scale-manager-language') === 'en' ? 'en' : 'sv'
document.documentElement.lang = language
void i18n.use(initReactI18next).init({
  lng: language, fallbackLng: 'sv', supportedLngs: ['sv', 'en'],
  resources: { sv: { translation: sv }, en: { translation: en } },
  interpolation: { escapeValue: false },
})
i18n.on('languageChanged', value => {
  document.documentElement.lang = value
  localStorage.setItem('scale-manager-language', value)
})
export default i18n
