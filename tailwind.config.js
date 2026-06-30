/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          gold:    '#FFD700',
          amber:   '#F59E0B',
          dark:    '#0A0A0F',
          surface: '#12121A',
          card:    '#1A1A26',
          border:  '#2A2A3A',
          muted:   '#4A4A6A',
          text:    '#E8E8F0',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)', 'monospace'],
      },
      animation: {
        'pulse-gold': 'pulse-gold 2s ease-in-out infinite',
        'ticker':     'ticker 20s linear infinite',
        'shimmer':    'shimmer 1.5s ease-in-out infinite',
        'bid-flash':  'bid-flash 0.6s ease-out',
      },
      keyframes: {
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,215,0,0)' },
          '50%':      { boxShadow: '0 0 20px 4px rgba(255,215,0,0.3)' },
        },
        'ticker': {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'bid-flash': {
          '0%':   { backgroundColor: 'rgba(255,215,0,0.4)', transform: 'scale(1.02)' },
          '100%': { backgroundColor: 'transparent', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
