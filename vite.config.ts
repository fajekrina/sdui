import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ['src/**/*'],
      outDir: 'dist',
      entryRoot: 'src',
      tsconfigPath: './tsconfig.json'
    })
  ],
  build: {
    lib: {
      entry: {
        'core/index': resolve(__dirname, 'src/core/index.ts'),
        'browser/index': resolve(__dirname, 'src/browser/index.ts'),
        'vanilla/index': resolve(__dirname, 'src/vanilla/index.ts'),
        'react/index': resolve(__dirname, 'src/react/index.ts'),
        'vue/index': resolve(__dirname, 'src/vue/index.ts'),
        'builder/index': resolve(__dirname, 'src/builder/index.ts'),
        'builder/react': resolve(__dirname, 'src/builder/react.tsx'),
        'bridge/index': resolve(__dirname, 'src/bridge/index.ts'),
        'compat/index': resolve(__dirname, 'src/compat/index.ts'),
        'builder/vue': resolve(__dirname, 'src/builder/vue.ts')
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        const ext = format === 'es' ? 'js' : 'cjs'
        return `${entryName}.${ext}`
      }
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'vue', 'react/jsx-runtime'],
      output: {
        exports: 'named',
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          vue: 'Vue'
        }
      }
    },
    sourcemap: true,
    emptyOutDir: true
  }
})
