# Fold

One-line pitch:

```txt
Fold memories into paper planes. Keep them for yourself, or set them free for the world to find.
```

## Local Phone Run

Use two terminals.

### 1. Backend

```bash
cd /Users/juliacheung/Development/experiments/graffiti
uv sync
uv run graffiti-seed
uv run graffiti-api --host 0.0.0.0 --port 8008
```

For iOS Simulator, the frontend can use:

```txt
http://localhost:8008
```

For a physical iPhone, get your Mac's Wi-Fi IP:

```bash
ipconfig getifaddr en0
```

If it prints `192.168.1.42`, use:

```txt
http://192.168.1.42:8008
```

### 2. Frontend

```bash
cd /Users/juliacheung/Development/experiments/graffiti/frontend
cp .env.example .env
```

Edit `.env`:

```env
EXPO_PUBLIC_API_URL=http://localhost:8008
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk_your_mapbox_public_token
EXPO_PUBLIC_MAPBOX_STYLE_URL=mapbox://styles/dasprasky/cmq1r5r42003001rfhfkx3yzc
```

For physical iPhone, use your Mac IP instead:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.42:8008
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk_your_mapbox_public_token
EXPO_PUBLIC_MAPBOX_STYLE_URL=mapbox://styles/dasprasky/cmq1r5r42003001rfhfkx3yzc
```

Install and run:

```bash
npm install
npx expo run:ios --device
```

For simulator:

```bash
npx expo run:ios
```

## Product Flow

Map screen:

```txt
Fold
Every thought starts folded.

[map]

✈ Fold a plane
```

Composer:

```txt
Fold a plane

write / draw / link

What should this place remember?
```

Release step:

```txt
What would you like to do with this plane?

□ Keep folded
Only visible on your map.

✈ Set it free
Leave it for future visitors.
```

Language to preserve:

- Use `plane`, `fold`, `unfold`, `set free`, `echo`.
- Avoid `post`, `publish`, `like`, `comment`, `feed`.

## Backbone

Backend:

- `uv` project
- stdlib HTTP server for hackathon speed
- SQLite local DB
- route/storage/cell boundaries matching the shape we can later move to FastAPI/Postgres

Frontend:

- Expo React Native app
- `expo-router`
- `expo-location`
- `@rnmapbox/maps`
- local anonymous device id via `expo-secure-store`

## Test

```bash
uv run python -m unittest discover -s tests
```
