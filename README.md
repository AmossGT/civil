# Road Sathi

A mobile-first tender transparency portal and FastAPI backend. Docker Compose runs the API and PostgreSQL/PostGIS; the API serves the portal and its JSON endpoints from one origin.

## Run from VS Code on Windows

You only need Docker Desktop with its Linux containers engine. No host Python, FastAPI, or PostgreSQL installation is required.

1. Open this folder in VS Code.
2. In the VS Code terminal, copy `.env.example` to `.env` and change the bootstrap admin password and `SECRET_KEY`.
   - PowerShell: `Copy-Item .env.example .env`
3. Build and start both services: `docker compose up --build`.
4. Open `http://localhost:8000/` for the portal, `http://localhost:8000/docs` for the API, and connect database tools to `localhost:5432`.

The first API startup enables PostGIS and creates the tables. The bootstrap admin is created if that email is not already registered. Admins can provision officers with `POST /api/v1/users`. Backend and public UI folders are bind-mounted for live reload. PostgreSQL data persists in the `tender_db` Docker volume; uploaded PDFs persist in the local `uploads/` folder.

The supplied prototype dataset is loaded on API startup by default (`LOAD_PROTOTYPE_DATA=true`). It adds records from `backend/app/prototype_data.json` only when each tender reference is absent, so restarts do not duplicate or overwrite them. The website labels these records as provisional and shows that their source notes are unverified. Set `LOAD_PROTOTYPE_DATA=false` in `.env` to disable future imports; already imported records remain in PostgreSQL until removed through a deliberate data cleanup. The seven supplied award/acceptance PDFs are stored in `backend/app/seed_documents`, copied into persistent upload storage on startup, and linked to their tenders through the `tender_documents` table. Future tenders can have multiple typed documents; public records expose document metadata and download URLs. The four KMZ route maps are stored in `backend/app/seed_geodata`; their named route geometries are indexed in PostGIS in `tender_spatial_features`, and the original KMZ files are linked as downloadable tender documents. The map API returns simplified GeoJSON for display while retaining full route geometry in the database.

Useful commands:

- Stop services: `docker compose down`
- Follow API logs: `docker compose logs -f api`
- Follow database logs: `docker compose logs -f db`
- Stop and remove the database volume: `docker compose down -v` (this permanently removes local database data)

## Connected features

- Public tender search, department/status/value filters, pagination, tender details, awards, contacts, and work-order downloads
- Live metrics, public activity, PostGIS map pins, and opt-in nearby search
- HttpOnly signed sessions, password hashing, role checks, and officer department isolation
- Officer draft creation, PDF upload, submission, and award entry
- Admin review, verification/rejection, entity and user management, audit history, and CSV import

Tender records carry an additive `extra_data` JSON object for future attributes. The UI ignores fields it does not use, while API clients can preserve and consume them. Keep sensitive or internal fields in explicit schemas rather than this public extension object.

Production deployment should replace the local credentials, use HTTPS (`COOKIE_SECURE=true`), restrict CORS, persist file storage, add request rate limiting, and back up both the database and upload store.
