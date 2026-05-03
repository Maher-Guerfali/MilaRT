/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        amber:  { DEFAULT: '#D97435', light: '#F08848' },
        gold:   '#E8B830',
        cream:  '#F3EDE0',
        paper:  '#FDFAF5',
        ink:    '#1A1510',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        fadeUp:    { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        tooltipIn: { from: { opacity: '0', transform: 'translateX(-6px)' }, to: { opacity: '1', transform: 'none' } },
        pulse:     { '0%,100%': { opacity: '1' }, '50%': { opacity: '.4' } },
        trayUp:    { from: { transform: 'translateY(100%)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        canvasIn:  { from: { opacity: '0', transform: 'scale(.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        marchAnt:  { to: { strokeDashoffset: '-16' } },
        itemWiggle: {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '20%':      { transform: 'translateY(-2px) rotate(-1deg)' },
          '40%':      { transform: 'translateY(-1.5px) rotate(0.8deg)' },
          '60%':      { transform: 'translateY(-2px) rotate(-0.8deg)' },
          '80%':      { transform: 'translateY(-1px) rotate(0.5deg)' },
        },
      },
      animation: {
        fadeUp:     'fadeUp 0.3s ease both',
        fadeIn:     'fadeIn 0.2s ease both',
        tooltipIn:  'tooltipIn 0.15s ease both',
        pulse:      'pulse 1s infinite',
        trayUp:     'trayUp 0.28s cubic-bezier(0.34,1.56,0.64,1) both',
        canvasIn:   'canvasIn 0.48s ease both',
        marchAnt:   'marchAnt 0.5s linear infinite',
        itemWiggle: 'itemWiggle 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
