/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'session-idle': '#22c55e',
        'session-working': '#eab308',
        'session-waiting': '#ef4444',
        'session-disconnected': '#6b7280',
      },
    },
  },
  plugins: [],
};
