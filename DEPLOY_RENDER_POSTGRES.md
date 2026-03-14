# Render + Postgres Deployment

This app now uses Postgres for its live database. For Render deployment, point
the app at a Render Postgres database using `DATABASE_URL`.

## Setup

1. Push this repository to GitHub.
2. In Render, create a Postgres database.
3. Copy the internal database URL into the web service env var `DATABASE_URL`.
4. Create a Render Blueprint or Web Service from this repo.
5. Render will use:
   - Build command: `npm run build`
   - Start command: `npm start`

## Required environment variables

- `DATABASE_URL`

## Optional environment variables

- `ADMIN_EMAIL`
- `ADMIN_NAME`

## Notes

- You do not need Google Cloud Storage for the live database anymore.
- If you want backups, use Render Postgres backups or export database snapshots separately.
- This setup is appropriate for multiple users making changes at the same time.
