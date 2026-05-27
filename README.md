# cowfarm route editor

This repository is the standalone route editor for the calf feeding robot. The official deployment entry is now the 5173 admin service in `calf-routeConfig-web`; this app keeps the same path-task and WebRTC contracts for local editing or fallback use.

Default integration endpoints:

- Route task submit: `POST http://120.48.24.192:5173/api/pathSettings`
- Device status: `GET http://120.48.24.192:5173/api/webget?deviceID=robot001`
- WebRTC viewer signaling: `ws://120.48.24.192:5173/ws/browser`

Use `VITE_API_BASE_URL` and `VITE_SIGNAL_URL` to point the standalone app at another server.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```
