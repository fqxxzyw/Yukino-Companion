// Compatibility surface for the account UI. The actual rule lives in shared/ so
// the desktop and the Worker cannot drift apart.
export {
  NICKNAME_MAX,
  PASSWORD_LIMITS,
  PASSWORD_MAX,
  PASSWORD_MIN,
  nicknamePolicyError as nicknameProblem,
  normalizeNickname,
  passwordPolicyError as passwordProblem,
} from '../../shared/password-policy.mjs';
