import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0b',
        surface: '#15151a',
        surface2: '#1c1c24',
        border: '#2a2a35',
        text: '#e8e8ec',
        textDim: '#9a9aa8',
        accent: '#5b9dff',
        accentDim: '#3a6cb0',
        success: '#3fb950',
        warn: '#d29922',
        danger: '#f85149',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
