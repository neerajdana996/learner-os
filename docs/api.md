# API

The backend listens on `http://localhost:3001`. The frontend proxy exposes the
same routes under `http://localhost:3000/api`.

## Auth

Real requests carry a session: an httpOnly cookie for the web app, or
`Authorization: Bearer <token>` for the extension. Both are rows in `sessions`.

```sh
# 1. request a link (the console transport prints it in dev)
curl -XPOST localhost:3001/auth/magic \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}'          # -> 200 {"ok":true}

# 2. exchange it for a session cookie (single use, 15-min expiry)
curl -i -c cookies.txt 'localhost:3001/auth/verify?token=<token-from-the-link>'

# 3. use the cookie
curl -b cookies.txt localhost:3001/topics

# 4. mint a bearer token for the extension
curl -XPOST -b cookies.txt localhost:3001/auth/extension-token
# -> 201 {"token":"...","expiresAt":"..."}
```

`POST /auth/magic` answers identically whether or not the address is
registered, so it cannot be used to discover who has an account.

**Dev shortcut:** outside production you may send `x-user-id: <uuid>` instead of
a session. It is rejected under `NODE_ENV=production`. The examples below use it
for brevity; substitute `-b cookies.txt` for anything production-like.
Replace `<user-id>` and `<topic-id>` with UUIDs from the database or seed data.

## Health

```sh
curl localhost:3001/health
```

## Topics

```sh
curl -XPOST localhost:3001/topics \
  -H 'content-type: application/json' \
  -H 'x-user-id: <user-id>' \
  -d '{"title":"React Hooks"}'

curl localhost:3001/topics -H 'x-user-id: <user-id>'
curl localhost:3001/topics/<topic-id> -H 'x-user-id: <user-id>'
```

The create response is `202` while the generation worker builds the map. Poll
the topic until its status is `active` or `failed`.

## Due items

```sh
curl 'localhost:3001/due?limit=5' -H 'x-user-id: <user-id>'
```

The response contains public question data only; answer keys remain on the
server.

## Reviews

```sh
curl -XPOST localhost:3001/reviews \
  -H 'content-type: application/json' \
  -H 'x-user-id: <user-id>' \
  -d '{"itemId":"<item-id>","response":"the answer","confidence":"sure","surface":"web"}'
```

## WebSocket

Connect to `ws://localhost:3001/ws`. Send `{"type":"ping"}` and the server
responds with `{"type":"pong"}`.