import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx,mdx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0B0B0B',
          850: '#121110',
          800: '#1A1816',
          750: '#221F1B',
          700: '#2B2722',
          600: '#3A342C',
          500: '#524A3F',
        },
        gold: {
          100: '#F8E6B6',
          200: '#F4D27A',
          300: '#E5BA63',
          400: '#C9A24A',
          500: '#A8842F',
          600: '#6E5520',
        },
        ivory: {
          100: '#FBF7EE',
          200: '#F4EDE0',
          300: '#E8DFCC',
          400: '#C9BFA9',
          500: '#8C8470',
        },
        crimson: {
          DEFAULT: '#B43A2E',
          light: '#D6584C',
        },
        felt: {
          green: '#1F3A2E',
          'green-2': '#2A4A3C',
        },
        success: '#6F9E6F',
        warning: '#C9A24A',
        danger: '#B43A2E',
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', '"Cormorant SC"', '"Trajan Pro"', 'Georgia', 'serif'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', '-apple-system', '"Söhne"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: '11px',
        sm: '12px',
        base: '14px',
        md: '15px',
        lg: '17px',
        xl: '20px',
        '2xl': '26px',
        '3xl': '36px',
        '4xl': '52px',
        '5xl': '72px',
        display: '96px',
      },
      spacing: {
        '0.5': '4px',
        '1': '8px',
        '1.5': '12px',
        '2': '16px',
        '2.5': '20px',
        '3': '24px',
        '4': '32px',
        '5': '40px',
        '6': '48px',
        '8': '64px',
        '10': '80px',
        '12': '96px',
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
        lg: '10px',
        xl: '14px',
        pill: '999px',
      },
      boxShadow: {
        xs: '0 1px 0 rgba(0,0,0,0.4)',
        sm: '0 2px 8px -2px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3)',
        md: '0 12px 32px -10px rgba(0,0,0,0.7), 0 2px 6px rgba(0,0,0,0.4)',
        lg: '0 32px 80px -20px rgba(0,0,0,0.8), 0 4px 12px rgba(0,0,0,0.5)',
        'gold-glow': '0 0 0 1px rgba(201,162,74,0.5), 0 0 24px -4px rgba(201,162,74,0.4)',
        'gold-glow-soft': '0 0 16px -4px rgba(201,162,74,0.25)',
      },
      backgroundImage: {
        'gold-grad': 'linear-gradient(135deg, #F4D27A 0%, #E5BA63 35%, #C9A24A 60%, #A8842F 100%)',
        'gold-grad-soft': 'linear-gradient(180deg, #F4D27A 0%, #C9A24A 100%)',
        'gold-grad-brushed':
          'linear-gradient(180deg, #C9A24A 0%, #F4D27A 30%, #C9A24A 50%, #A8842F 100%)',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0.6, 0.2, 1)',
        press: 'cubic-bezier(0.4, 0, 0.4, 1)',
      },
      transitionDuration: {
        fast: '140ms',
        DEFAULT: '220ms',
        slow: '380ms',
        cinematic: '720ms',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        pulse: 'pulse 2s cubic-bezier(0.2, 0.6, 0.2, 1) infinite',
        shimmer: 'shimmer 6s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
