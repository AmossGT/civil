# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## RoadSathi portal

React 19 and Vite frontend for the RoadSathi public procurement portal. The app reads tender, detail, department, statistics, activity and map-search data from the existing FastAPI service. It does not include a fabricated tender dataset. When the API is unavailable, it shows an error or empty state.

### Run the complete website at one local address

The React portal is built into the existing FastAPI static directory. Start the application from the `civil` project root:

```powershell
docker compose up --build
```

Open the complete website at **http://localhost:8000/**. The React UI, API, and staff sign-in entry point use this one origin. Do not start the Vite development server for the normal run; that creates the separate `localhost:5173` address.

To publish changes to the React source, build it once from this folder:

```powershell
cd frontend-roadsathi
npm install  # first time only
npm run build
```

The build updates the files served at `http://localhost:8000/`; refresh that page to see the changes. There is no second website address or separate frontend server in this workflow.

### Publish the React portal through the existing backend

`npm run build` writes the public RoadSathi portal into `../public`, which FastAPI already serves at `http://localhost:8000/`. The build replaces the public root `index.html` and adds hashed files under `public/assets`; it does not clear the output directory, so the existing `/admin/v1/` and `/department/v1/` pages and their scripts remain in place. No backend or Docker configuration changes are needed.

### Configuration and data notes

- `VITE_BACKEND_ORIGIN` changes the backend origin used only by the optional Vite development server (default `http://localhost:8000`). The single-address run above does not use Vite's server.
- `VITE_API_BASE_URL` changes the browser API prefix (default `/api/v1`). For production, use the deployed API origin and allow the frontend origin on that API.
- `VITE_STAFF_SIGN_IN_URL` changes the Staff Sign In destination (default `http://localhost:8000/`, the existing portal sign-in entry point).
- The map uses Leaflet and OpenStreetMap tiles from public CDNs.
- The overview hero uses [Indo-Myanmar Road, Asian Highway No.1](https://commons.wikimedia.org/wiki/File:Indo-Myanmar_Road,_Asian_Highway_No.1.jpg), credited to Premdatta Laitonjam under CC BY-SA 4.0; the page displays the image credit.
- Award of Contract (AOC) values appear when provided by the API. Amounts disbursed are shown only if the API exposes that field; the current API does not, so the page says “Not disclosed”. Prototype records retain their API-supplied prototype and verification notes in the details view.
