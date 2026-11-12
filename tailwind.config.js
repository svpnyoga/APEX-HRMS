/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(--${v}) / <alpha-value>)`
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        figure: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', 'sans-serif'],
      },
      colors: {
        canvas: c('canvas'), surface: c('surface'), raised: c('raised'), line: c('line'),
        ink: { DEFAULT: c('ink'), soft: c('ink-soft'), line: c('ink-line'), text: c('ink-text'), muted: c('ink-muted') },
        text: c('text'), muted: c('muted'), subtle: c('subtle'),
        primary: { DEFAULT: c('primary'), soft: c('primary-soft'), fg: c('primary-fg') },
        success: { DEFAULT: c('success'), soft: c('success-soft') },
        warning: { DEFAULT: c('warning'), soft: c('warning-soft') },
        danger: { DEFAULT: c('danger'), soft: c('danger-soft') },
        info: { DEFAULT: c('info'), soft: c('info-soft') },
        scan: c('scan'),
      },
      borderRadius: { xl: '14px', lg: '10px', md: '8px', sm: '6px' },
      boxShadow: { card: '0 1px 2px rgb(15 27 61 / 0.05)', pop: '0 12px 32px -8px rgb(15 27 61 / 0.25)' },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'pop-in': { from: { opacity: 0, transform: 'translateY(4px) scale(.98)' }, to: { opacity: 1, transform: 'none' } },
        sweep: { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { 'fade-in': 'fade-in .15s ease-out', 'pop-in': 'pop-in .16s ease-out', sweep: 'sweep 2.4s linear infinite' },
    },
  },
  plugins: [],
}
