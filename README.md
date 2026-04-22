# MilaRT

A free, self-hostable Milanote-style visual board. Rooms via 6-char code, draggable sticky notes, pasted images, nested boards, and handwriting notes (iPad / Apple Pencil friendly).

## Stack

- **Client**: React + Vite + TypeScript + Tailwind
- **Server**: Node + Express + Mongoose (MongoDB)
- **Storage**: Images on server filesystem (persistent volume in prod)
- **Sync**: Autosave every ~2s, manual refresh to pull collaborator changes

## Local development

```bash
# One-time setup
npm run install:all

# Copy env template and set MONGODB_URI (from Atlas free tier)
cp server/.env.example server/.env

# Run client (5173) + server (4000) together
npm run dev
```

Open http://localhost:5173.

## Deploy (Railway)

1. Create a MongoDB Atlas free cluster, copy the connection string.
2. Push this repo to GitHub.
3. In Railway: **New Project → Deploy from repo**.
4. Set env vars:
   - `MONGODB_URI` = your Atlas connection string
   - `NODE_ENV` = `production`
5. Add a persistent volume mounted at `/app/server/uploads` (so pasted images survive redeploys).
6. Railway will run `npm run build` then `npm start`.

## Project layout

```
client/   Vite React frontend
server/   Express API + serves built frontend in prod
```
