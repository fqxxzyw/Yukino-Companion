# Outfit unlock rules

The single source of truth is `shared/outfit-rules.json`. The Worker, renderer,
main-process skin gate and account page all read it. Adding an outfit means
adding one entry there plus its model/thumbnail entry in
`resources/character-models.json`; no page or lock rule should be edited
separately.

## Current rules (v0.4.2)

| Outfit | Rule | Unlock |
| --- | --- | --- |
| 夏日制服 · `summer-uniform-v2` | base | Default |
| 冬季制服 · `winter-uniform-v2` | base | Default |
| 泳装 · `swimsuit-v2` | login-days | 2 confirmed login days |
| 双马尾 · `twin-tail-v2` | login-days | 3 confirmed login days |
| 贝雷帽 · `beret-v2` | affection | 45 confirmed affection |
| 和服 · `kimono-v2` | affection | 55 confirmed affection |
| 黑色旗袍 · `qipao-v2` | affection | 65 confirmed affection |
| 象牙大衣 · `ivory-coat-v2` | affection | 75 confirmed affection |
| 冰蓝连帽冬装 · `ice-hooded-winter-v2` | affection | 85 confirmed affection |

A login day is one successful server check-in on an Asia/Shanghai business
date. Opening the app repeatedly on the same date does not increase the count.
Offline events are queued and do not unlock cloud outfits until the server
confirms them.

## Account authority and offline behaviour

- For a signed-in account, `cloudUnlocked` is the server-confirmed outfit list.
  Local affection and local used-date counters do not unlock account outfits.
- The desktop caches the last confirmed list. Disconnecting does not remove an
  already earned outfit.
- Reconnecting refreshes progress and submits queued interaction events. New
  outfits appear only after the server records them.
- The signed entitlement snapshot is preferred. If the build has no verification
  key, the authenticated progress response is used and the UI marks the
  entitlement as unverified.

## Existing rights

Rows in `skin_unlocks` are never deleted by a rules update. The previous V1 ids
map to the matching approved V2 outfit:

- `yukino-01-v1`, `yukino-03-v1` → `swimsuit-v2`
- `yukino-02-v1` → `beret-v2`
- `yukino-04-v1` → `kimono-v2`
- `yukino-05-v1` → `qipao-v2`
- `yukino-07-v1` → both default school uniforms

`yukino-06-v1` (maid) has no approved V2 equivalent. Its row is retained but no
new outfit is invented or mapped to it.
