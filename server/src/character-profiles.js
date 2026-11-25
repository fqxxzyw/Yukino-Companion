import {all, run} from './db.js';
import {authenticate} from './session.js';
import {fail, json} from './util.js';

export async function listCharacters({request, env, db, now}) {
  const {user} = await authenticate(request, env, db, now);
  const characters = await all(db, 'SELECT character_id AS id, name, persona FROM character_profiles WHERE user_id = ? ORDER BY name, character_id', user.id);
  return json({characters});
}

export async function saveCharacter({request, env, db, now, id, body}) {
  const {user} = await authenticate(request, env, db, now);
  if (Object.keys(body).some(key => key !== 'name' && key !== 'persona') ||
      typeof body.name !== 'string' || !body.name.trim() || body.name.length > 60 ||
      typeof body.persona !== 'string' || body.persona.length > 12000) {
    fail(400, 'invalid_character', '请提交角色名字和文字设定。');
  }
  const result = await run(db, `INSERT INTO character_profiles(user_id, character_id, name, persona)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM character_profiles WHERE user_id = ? AND character_id = ?)
      OR (SELECT count(*) FROM character_profiles WHERE user_id = ?) < 100
    ON CONFLICT(user_id, character_id) DO UPDATE SET name = excluded.name, persona = excluded.persona`,
    user.id, id, body.name.trim(), body.persona, user.id, id, user.id);
  if (!result.changes) fail(409, 'character_limit', '已达到 100 个云端角色上限。');
  return json({ok: true});
}
