# Frontend

The frontend will present authoritative state returned by the API. It must not
perform gameplay resolution locally or treat animation timing as game logic.

## Local development

Run the backend on port 8000, then:

```bash
npm install
npm run dev
```

The Vite server runs on port 5173 and proxies `/api` requests to the local
backend. The current screen creates or reloads a local development save and
advances the Western Road.
