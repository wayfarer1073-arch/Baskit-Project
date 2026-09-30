import bcrypt from 'bcryptjs';

/**
 * 비밀번호 해시 강도(bcrypt cost). 12는 로그인 한 번에 수백 ms 정도로, 유출된 해시를 대량으로 맞춰 보는 공격을 크게 늦춘다.
 * 예전에 cost 10으로 만든 해시도 bcrypt.compare로 그대로 확인된다.
 */
export const PASSWORD_HASH_ROUNDS = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
}
