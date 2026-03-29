import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ExternalStorageConfig {
  provider: "b2" | "minio";
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  uploadExpirySeconds: number;
  readExpirySeconds: number;
}

const cachedClients: Record<string, S3Client> = {};

export function getExternalStorageConfigOrNull(): ExternalStorageConfig | null {
  return getB2ConfigOrNull();
}

export function getB2ConfigOrNull(): ExternalStorageConfig | null {
  const bucket = process.env.B2_BUCKET;
  const region = process.env.B2_REGION ?? "us-west-004";
  const endpoint = process.env.B2_S3_ENDPOINT;
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    provider: "b2",
    bucket,
    region,
    endpoint: normalizeEndpoint(endpoint),
    accessKeyId,
    secretAccessKey,
    uploadExpirySeconds: Number(process.env.B2_UPLOAD_URL_TTL_SECONDS ?? 900),
    readExpirySeconds: Number(process.env.B2_READ_URL_TTL_SECONDS ?? 3600),
  };
}

export function requireExternalStorageConfig(): ExternalStorageConfig {
  return requireB2Config();
}

export function requireB2Config(): ExternalStorageConfig {
  const config = getB2ConfigOrNull();
  if (!config) {
    throw new Error(
      "External storage is not configured. Set B2_BUCKET, B2_S3_ENDPOINT, B2_KEY_ID, and B2_APPLICATION_KEY.",
    );
  }
  return config;
}

export function getMinioConfigOrNull(): ExternalStorageConfig | null {
  const bucket = process.env.MINIO_BUCKET;
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKeyId = process.env.MINIO_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_SECRET_KEY;
  const region = process.env.MINIO_REGION ?? "us-east-1";

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    provider: "minio",
    bucket,
    region,
    endpoint: normalizeEndpoint(endpoint),
    accessKeyId,
    secretAccessKey,
    uploadExpirySeconds: Number(process.env.MINIO_UPLOAD_URL_TTL_SECONDS ?? 900),
    readExpirySeconds: Number(process.env.MINIO_READ_URL_TTL_SECONDS ?? 3600),
  };
}

export function requireMinioConfig(): ExternalStorageConfig {
  const config = getMinioConfigOrNull();
  if (!config) {
    throw new Error(
      "MinIO archive storage is not configured. Set MINIO_BUCKET, MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY.",
    );
  }
  return config;
}

export async function createExternalUploadUrl(params: {
  bucket?: string;
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<{ url: string; expiresAt: number }> {
  const config = requireB2Config();
  return createSignedUploadUrl(config, {
    bucket: params.bucket ?? config.bucket,
    objectKey: params.objectKey,
    contentType: params.contentType,
    expiresInSeconds: params.expiresInSeconds,
  });
}

export async function createExternalReadUrl(params: {
  bucket?: string;
  objectKey: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const config = requireB2Config();
  return createSignedReadUrl(config, {
    bucket: params.bucket ?? config.bucket,
    objectKey: params.objectKey,
    expiresInSeconds: params.expiresInSeconds,
  });
}

export async function createSignedUploadUrl(
  config: ExternalStorageConfig,
  params: {
    bucket: string;
    objectKey: string;
    contentType: string;
    expiresInSeconds?: number;
  },
): Promise<{ url: string; expiresAt: number }> {
  const client = getS3Client(config);
  const expiresIn = params.expiresInSeconds ?? config.uploadExpirySeconds;
  const command = new PutObjectCommand({
    Bucket: params.bucket,
    Key: params.objectKey,
    ContentType: params.contentType,
  });
  const url = await getSignedUrl(client, command, { expiresIn });
  return {
    url,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function createSignedReadUrl(
  config: ExternalStorageConfig,
  params: {
    bucket: string;
    objectKey: string;
    expiresInSeconds?: number;
  },
): Promise<string> {
  const client = getS3Client(config);
  const expiresIn = params.expiresInSeconds ?? config.readExpirySeconds;
  const command = new GetObjectCommand({
    Bucket: params.bucket,
    Key: params.objectKey,
  });
  return getSignedUrl(client, command, { expiresIn });
}

export async function deleteExternalObject(params: {
  bucket?: string;
  objectKey: string;
}): Promise<void> {
  const config = requireB2Config();
  const client = getS3Client(config);
  const command = new DeleteObjectCommand({
    Bucket: params.bucket ?? config.bucket,
    Key: params.objectKey,
  });
  await client.send(command);
}

export async function copyObjectBetweenStores(params: {
  sourceConfig: ExternalStorageConfig;
  sourceBucket: string;
  sourceObjectKey: string;
  destinationConfig: ExternalStorageConfig;
  destinationBucket: string;
  destinationObjectKey: string;
  contentType?: string;
}): Promise<void> {
  const sourceClient = getS3Client(params.sourceConfig);
  const destinationClient = getS3Client(params.destinationConfig);

  const getResult = await sourceClient.send(
    new GetObjectCommand({
      Bucket: params.sourceBucket,
      Key: params.sourceObjectKey,
    }),
  );

  const bodyBytes = await readBodyBytes(getResult.Body);
  const contentType = params.contentType ?? getResult.ContentType ?? "application/octet-stream";

  await destinationClient.send(
    new PutObjectCommand({
      Bucket: params.destinationBucket,
      Key: params.destinationObjectKey,
      Body: bodyBytes,
      ContentType: contentType,
    }),
  );
}

function normalizeEndpoint(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  return `https://${endpoint}`;
}

function getS3Client(config: ExternalStorageConfig): S3Client {
  const cacheKey = `${config.endpoint}|${config.region}|${config.accessKeyId}`;
  const cached = cachedClients[cacheKey];
  if (cached) {
    return cached;
  }

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClients[cacheKey] = client;
  return client;
}

async function readBodyBytes(body: unknown): Promise<Uint8Array> {
  if (!body) {
    throw new Error("Source object body was empty.");
  }

  const candidate = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };

  if (typeof candidate.transformToByteArray === "function") {
    return candidate.transformToByteArray();
  }

  if (typeof candidate.arrayBuffer === "function") {
    const buffer = await candidate.arrayBuffer();
    return new Uint8Array(buffer);
  }

  if (body instanceof Uint8Array) {
    return body;
  }

  throw new Error("Unable to read object body bytes from source storage response.");
}
