/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0E1A24',        // Anthrazit – Text, Kopfzeile
        steel: '#5A6B7A',      // Sekundärtext, Rahmen
        hall: '#EEF1F3',       // Hallenboden – Seitenhintergrund
        signal: '#F2A007',     // Warnmarkierung – Abnahme ausstehend
        run: '#1F6FEB',        // In Bearbeitung
        done: '#0F7A5A',       // Abgenommen
        stop: '#C0392B'        // Störung / kritisch
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      borderRadius: { card: '10px' }
    }
  },
  plugins: []
}
