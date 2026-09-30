import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * 업로드 원본 파일처럼 크고 자주 읽지 않는 파일을 두는 객체 저장소.
 *
 * DB 저장 공간은 GB당 단가가 가장 비싸므로, 운영에서는 S3 호환 저장소(AWS S3, Cloudflare R2, Supabase Storage,
 * MinIO 등)를 쓴다. 환경변수가 없으면 null — 그때는 호출하는 쪽이 DB에 둔다(로컬 개발·테스트 기본값).
 *
 *   FILE_STORAGE_BUCKET        버킷 이름(설정하면 저장소 사용)
 *   FILE_STORAGE_REGION        기본 auto (R2는 auto, AWS는 ap-northeast-2 등)
 *   FILE_STORAGE_ENDPOINT      AWS가 아니면 엔드포인트 URL (예: https://<account>.r2.cloudflarestorage.com)
 *   FILE_STORAGE_ACCESS_KEY_ID / FILE_STORAGE_SECRET_ACCESS_KEY
 *   FILE_STORAGE_FORCE_PATH_STYLE  MinIO·Supabase처럼 경로 방식 주소가 필요하면 true
 */
export interface FileStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

export interface S3FileStoreConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export function createS3FileStore(config: S3FileStoreConfig): FileStore {
  const client = new S3Client({
    region: config.region || 'auto',
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle,
    // R2·MinIO 등 S3 호환 저장소는 SDK 기본 체크섬 헤더를 모두 지원하지 않으므로 필요할 때만 쓴다.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: config.accessKeyId && config.secretAccessKey ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } : undefined,
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (!res.Body) return null;
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (e) {
        if (e instanceof NoSuchKey || (e as { name?: string }).name === 'NoSuchKey') return null;
        throw e;
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}

function configFromEnv(): S3FileStoreConfig | null {
  const bucket = process.env.FILE_STORAGE_BUCKET?.trim();
  if (!bucket) return null;
  return {
    bucket,
    region: process.env.FILE_STORAGE_REGION,
    endpoint: process.env.FILE_STORAGE_ENDPOINT,
    accessKeyId: process.env.FILE_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.FILE_STORAGE_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.FILE_STORAGE_FORCE_PATH_STYLE === 'true',
  };
}

let override: FileStore | null | undefined;
let cached: FileStore | null | undefined;

/** 설정된 객체 저장소. 설정이 없으면 null(DB에 저장). */
export function getFileStore(): FileStore | null {
  if (override !== undefined) return override;
  if (cached === undefined) {
    const config = configFromEnv();
    cached = config ? createS3FileStore(config) : null;
  }
  return cached;
}

/** 테스트에서 저장소를 바꿔 끼운다. undefined를 넘기면 환경변수 설정으로 돌아간다. */
export function setFileStoreForTests(store: FileStore | null | undefined) {
  override = store;
}
