# Next.js frontend plan

Scaffold a TypeScript Next.js app beside the existing Python server. Do not change the page. [web/index.html](web/index.html) is copied verbatim into the root page file. [web/style.css](web/style.css) and [web/app.js](web/app.js) stay linked the same way they are linked now. [server.py](server.py), [cli.py](cli.py), [soundcloud_pull.py](soundcloud_pull.py), and [make_instrumental.py](make_instrumental.py) stay as they are, including `run` and `serve`.

The new app lives in `frontend/` so it does not sit on top of the Python modules or replace `web/`.

## 1. Scaffold

Create:

- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/next.config.mjs`
- `frontend/app.tsx`
- `frontend/public/style.css`
- `frontend/public/app.js`

Add `frontend/node_modules/` and `frontend/.next/` to [.gitignore](.gitignore).

Do not edit the README, the Python modules, or the files in `web/`.

`package.json` dependencies:

- `next`
- `react`
- `react-dom`

Dev dependencies required for a TypeScript app: `typescript`, `@types/react`, `@types/react-dom`, `@types/node`.

Scripts: `dev` runs `next dev`, `build` runs `next build`, `start` runs `next start`.

`tsconfig.json` is the Next.js TypeScript base: `"jsx": "preserve"`, `"moduleResolution": "bundler"`, and an include that covers `app.tsx`.

`next.config.mjs` only proxies the paths the current page already calls. The script in `web/app.js` posts to `/api/jobs` and loads `/files/...` on the same origin. The Python server still owns those routes on `127.0.0.1:8765` ([server.py](server.py) `serve`, default port 8765).

```js
const nextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://127.0.0.1:8765/api/:path*" },
      { source: "/files/:path*", destination: "http://127.0.0.1:8765/files/:path*" },
    ];
  },
};

export default nextConfig;
```

No other Next config.

## 2. Root page

`frontend/app.tsx` is the root page file. Its entire contents are a byte-for-byte copy of [web/index.html](web/index.html).

That file is the document as it exists today: doctype, the stylesheet link, the form, and the script tag. It is not wrapped in a React component. It is not split into components. Styles are not extracted. `class` is not rewritten to `className`.

The current document already points at the assets:

- `<link rel="stylesheet" href="/style.css" />`
- `<script src="/app.js"></script>`

Those tags stay. There is no inline script and no inline stylesheet in the HTML, so nothing is moved into a component body.

## 3. CSS and script

Copy [web/style.css](web/style.css) to `frontend/public/style.css` unchanged.

Copy [web/app.js](web/app.js) to `frontend/public/app.js` unchanged.

Next serves `public/` at the site root, so `/style.css` and `/app.js` resolve the same way they do when [server.py](server.py) serves `web/`. The DOM logic in `app.js` (source toggle, stem presets, format list, job polling, file links) stays in that file.

## 4. Python backend

Leave these untouched:

- [server.py](server.py)
- [cli.py](cli.py)
- [soundcloud_pull.py](soundcloud_pull.py)
- [make_instrumental.py](make_instrumental.py)

`python cli.py run` and `cloud-chaser serve` still start the Python app on http://127.0.0.1:8765. On this machine the interpreter is `.venv/bin/python`, because `python` is not on `PATH`.

The Python server keeps serving the original `web/` page. The Next app is a second process.

## 5. Start the Next dev server

In one terminal, start the API:

```bash
.venv/bin/python cli.py run
```

In another:

```bash
cd frontend
npm install
npm run dev
```

Next defaults to http://127.0.0.1:3000. The page there loads `/style.css` and `/app.js` from `frontend/public/`, and `/api` plus `/files` are rewritten to port 8765.

## 6. Verification

- `frontend/app.tsx` matches `web/index.html` with `cmp` or `diff` and no output.
- `frontend/public/style.css` matches `web/style.css`.
- `frontend/public/app.js` matches `web/app.js`.
- `package.json` lists `next`, `react`, and `react-dom` under `dependencies`.
- `git diff` does not touch `server.py`, `cli.py`, `soundcloud_pull.py`, or `make_instrumental.py`.
- With the Python server up, open http://127.0.0.1:3000 and confirm the same form: Link and File, the allowed-type line, Whole track and Stems, and a job that returns a download link.
- `npm run build` is optional. Record the result. Do not need the Python virtualenv for the Next build.

## Known issue

`frontend/app.tsx` will not compile under Next until it is real TSX. A verbatim HTML document (doctype, `<link>`, `<script src>`) is invalid in a `.tsx` module. That is intentional: this pass only places the current page in the root file. Component splits and styling stay for a later pass. `npm run dev` is expected to fail on that parse until then. `npm install` and the file comparison above still stand.
