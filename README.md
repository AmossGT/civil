# Road Sathi

Road Sathi is a public procurement transparency portal for tender, contractor, award, document, contact, and road-route information. The browser UI and FastAPI JSON API are served from one origin. Docker Compose runs the API and PostgreSQL/PostGIS.

## Requirements

- Docker Desktop with the Linux containers engine and Docker Compose v2
- Git, if cloning the repository
- VS Code is optional; no host Python, FastAPI, or PostgreSQL installation is needed for the Docker workflow

## Quick start (Windows / VS Code)

1. Clone the repository and open its root folder in VS Code.
2. Create a local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env`. Replace `POSTGRES_PASSWORD` and `SECRET_KEY`. Leave the optional bootstrap administrator values blank to use the one-time verified setup page. Keep `.env` local; it is ignored by Git.
4. Start the application:

   ```powershell
   docker compose up --build
   ```

5. Open:
   - Public portal: <http://localhost:8000/>
   - FastAPI/OpenAPI docs: <http://localhost:8000/docs>
   - PostgreSQL: `localhost:5432`, using `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`

The API startup enables PostGIS, creates missing tables, and optionally seeds prototype data. With no bootstrap administrator configured, use **Staff Sign In** and complete the first-admin email verification setup; the setup automatically closes once an admin account exists. The API and `public/` folders are mounted for local reload while developing.

## Environment variables

Compose reads `.env` for interpolation. These values are passed to the API or database container as shown below.

| Variable | Default in `.env.example` | Purpose |
|---|---|---|
| `POSTGRES_DB` | `tenders` | Database created by the PostGIS container and used by the API connection string. |
| `POSTGRES_USER` | `tender` | Database user. |
| `POSTGRES_PASSWORD` | `tender` | Database password. Choose a local-only value; use a managed secret in deployment. |
| `SECRET_KEY` | `change-this-local-secret-key-before-deploying` | HMAC signing key for access tokens. Replace with a long, random secret. |
| `UPLOAD_DIR` | `/app/uploads` | Upload directory inside the API container. Compose mounts this path to the persistent `tender_documents` volume. |
| `ALLOWED_ORIGINS` | `http://localhost:8000,http://localhost:5173` | Comma-separated CORS origins. Use only the deployed portal origins in production. |
| `COOKIE_SECURE` | `false` | Sets the `Secure` flag on authentication cookies. Enable with HTTPS in production. |
| `MAX_UPLOAD_BYTES` | `15728640` | Maximum accepted upload size in bytes (15 MiB by default). |
| `SMTP_HOST` | blank | SMTP server used to deliver the first-admin verification code. Required only when no admin exists. |
| `SMTP_PORT` | `587` | SMTP port; use `465` for implicit TLS. |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | blank | Optional SMTP authentication credentials. Keep the password in the local `.env`, never in source control. |
| `SMTP_FROM_EMAIL` | blank | Sender address for first-admin verification messages. Required only when no admin exists. |
| `SMTP_USE_TLS` | `true` | Use TLS for SMTP delivery. |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | blank | Optional local/test-only bootstrap. If both are set, startup creates this administrator and the one-time setup page is closed. Leave blank for normal first-admin setup. |
| `LOAD_PROTOTYPE_DATA` | `true` | Enables idempotent import of the supplied prototype records and map data at API startup. `false` disables future seed imports but does not delete imported rows. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access-token lifetime. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh-token lifetime. |

Compose builds `DATABASE_URL` from the three `POSTGRES_*` values. When running the API outside Docker, set `DATABASE_URL` directly to a SQLAlchemy PostgreSQL URL such as `postgresql+psycopg://user:password@localhost:5432/tenders`.

## Data, documents, and persistence

The seven tender records in `backend/app/prototype_data.json` and the route data in `backend/app/prototype_geodata.json` are the existing sample dataset. The seed loader does not overwrite existing tender records, and it uses the source metadata to identify prototype values as unverified. Keep this sample dataset unchanged when updating the application unless you are deliberately updating the source data.

The original supplied PDFs and KMZ files are kept under `backend/app/seed_documents/` and `backend/app/seed_geodata/`. Startup copies the PDFs into the upload volume and links document records to tenders. Named route geometries are stored in PostGIS; the source KMZ files are also linked as documents. The `tender_db` and `tender_documents` named Docker volumes persist database rows and uploaded/source documents across container restarts.

Useful commands:

```powershell
docker compose up --build       # build and run in the foreground
docker compose up -d --build    # build and run in the background
docker compose logs -f api      # follow API logs
docker compose logs -f db       # follow database logs
docker compose down             # stop services; preserve volumes
docker compose down -v          # stop and permanently delete local database and document volumes
```

Do not run `docker compose down -v` unless you intend to remove the local database and document data.

## Tests and sample data

The repository contains the sample records described above and an API integration verification script at [`backend/tests/verify_all.py`](backend/tests/verify_all.py). It checks health/authentication and token refresh, admin tender operations, department-viewer access restrictions, public visibility, map responses, CSV import behavior, tender identifiers for the seven supplied packages, and logout revocation.

The script uses fixed local test credentials (`admin@example.gov.in` / `RoadSathi-Test-Admin1!`) and writes test users and tender rows. Run it only against a disposable local database configured with those credentials, never against production or a database containing records you need to keep:

```powershell
# Stop the normal stack first so the test stack can use ports 8000 and 5432.
docker compose down
Copy-Item .env.example .env.test
Add-Content .env.test "`nBOOTSTRAP_ADMIN_EMAIL=admin@example.gov.in`nBOOTSTRAP_ADMIN_PASSWORD=RoadSathi-Test-Admin1!"
docker compose --env-file .env.test -p roadsathi-test up -d --build
docker compose --env-file .env.test -p roadsathi-test exec api python backend/tests/verify_all.py
docker compose --env-file .env.test -p roadsathi-test down -v
Remove-Item .env.test
```

The isolated Compose project uses separate named volumes. The test script is an integration verification suite, not a unit-test runner.

## Architecture and API

See [Technical Design](docs/TECHNICAL_DESIGN.md) for the architecture diagrams, request flow, data relationships, security boundaries, and operational notes.

The public API is rooted at `/api/v1`; common endpoints include:

- `GET /health`, `GET /stats`, and `GET /activity`
- `GET /tenders` with search, department/status filters, pagination, and sorting
- `GET /tenders/{tender_ref}` and `GET /tenders/{tender_ref}/documents`
- `GET /tenders/map`, `GET /tenders/nearby`, and `GET /tenders/geo-search?lat=...&lng=...` (checkpoint-radius search)
- `/auth/*`, `/admin/*`, and `/viewer/*` for authentication and role-restricted workflows

Administrators manage map-search checkpoints through `GET/POST /api/v1/admin/geo-checkpoints`, `PUT /api/v1/admin/geo-checkpoints/{id}`, and `DELETE /api/v1/admin/geo-checkpoints/{id}`. Each checkpoint accepts a name, latitude, longitude, radius in metres, and one or more existing `tender_refs`.

Interactive endpoint schemas are available at `/docs` while the API is running.

## License and supplied source materials

The Road Sathi software source code is licensed under the Apache License, Version 2.0; see [`LICENSE`](LICENSE). This license applies to the project software and does not grant rights to supplied or third-party tender PDFs, KMZ/map files, logos, marks, or other source materials. Those remain subject to their respective owners' rights and terms; check permissions before redistributing them.

## Production considerations

The supplied credentials and settings are for local development only. Before deployment, use managed secrets, strong unique database credentials, HTTPS with `COOKIE_SECURE=true`, restricted CORS origins, persistent protected document storage, database and document backups, rate limiting, and a production-appropriate database migration process. The current startup path creates missing tables but is not a versioned migration system.
