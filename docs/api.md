# API

The backend listens on `http://localhost:3001`. The frontend proxy exposes the
same routes under `http://localhost:3000/api`.

Development requests use the `x-user-id` header until magic-link auth lands.
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