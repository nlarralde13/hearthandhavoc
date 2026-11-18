# Backend

The backend will contain the FastAPI application, domain modules, persistence,
authentication boundary, and versioned API contracts.

Domain rules must remain usable without HTTP, database, or model-provider
dependencies so they can be tested deterministically.
