/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // 关闭 Preflight：应用大量使用 inline style（未迁移组件），全局 reset 会破坏现有外观
  corePlugins: { preflight: false },
  theme: {
    extend: {},
  },
  plugins: [],
};
