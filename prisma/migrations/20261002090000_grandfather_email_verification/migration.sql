-- 이메일 인증 전에는 앱에 들어갈 수 없게 바꾸면서, 이미 쓰고 있던 계정은 막히지 않도록 인증된 것으로 본다.
-- (지금까지는 메일 서비스가 설정되지 않아 인증 메일을 받을 수 없었다.) 이후 새로 가입하는 계정부터 인증이 필요하다.
UPDATE "users"
SET "emailVerifiedAt" = "createdAt"
WHERE "emailVerifiedAt" IS NULL
  AND "isActive" = true;
