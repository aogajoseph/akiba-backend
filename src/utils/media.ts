import fs from 'fs/promises';
import path from 'path';

import { Request } from 'express';

import { MessageMedia } from '../../../shared/contracts';
import { createHttpError, createId } from './http';

const MAX_MEDIA_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const UPLOADS_DIRECTORY = path.join(process.cwd(), 'uploads');

const MIME_TYPE_TO_MEDIA_TYPE: Record<string, MessageMedia['type']> = {
  'image/heic': 'image',
  'image/heif': 'image',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
};

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

export type ParsedMultipartFile = {
  buffer: Buffer;
  fileName: string;
  fieldName: string;
  mimeType: string;
  size: number;
};

export type ParsedMultipartFormData = {
  fields: Record<string, string>;
  files: ParsedMultipartFile[];
};

const getBoundary = (contentTypeHeader: string | undefined): string => {
  if (!contentTypeHeader?.includes('multipart/form-data')) {
    throw createHttpError(400, 'Content-Type must be multipart/form-data');
  }

  const match = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] ?? match?.[2];

  if (!boundary) {
    throw createHttpError(400, 'Multipart boundary is missing');
  }

  return boundary;
};

const parseContentDisposition = (
  headerValue: string,
): { fieldName: string; fileName?: string } => {
  const fieldMatch = headerValue.match(/name="([^"]+)"/i);
  const fileMatch = headerValue.match(/filename="([^"]*)"/i);

  if (!fieldMatch) {
    throw createHttpError(400, 'Multipart field name is missing');
  }

  return {
    fieldName: fieldMatch[1],
    fileName: fileMatch?.[1],
  };
};

export const parseMultipartFormData = async (
  req: Request,
): Promise<ParsedMultipartFormData> => {
  const boundary = getBoundary(req.header('content-type'));
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });

  const rawBody = Buffer.concat(chunks);
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const headerSeparatorBuffer = Buffer.from('\r\n\r\n');
  const fields: Record<string, string> = {};
  const files: ParsedMultipartFile[] = [];
  let cursor = rawBody.indexOf(boundaryBuffer);

  while (cursor >= 0) {
    let partStart = cursor + boundaryBuffer.length;

    if (rawBody.subarray(partStart, partStart + 2).equals(Buffer.from('--'))) {
      break;
    }

    if (rawBody.subarray(partStart, partStart + 2).equals(Buffer.from('\r\n'))) {
      partStart += 2;
    }

    const nextBoundaryIndex = rawBody.indexOf(boundaryBuffer, partStart);

    if (nextBoundaryIndex < 0) {
      break;
    }

    const partEnd = rawBody.subarray(nextBoundaryIndex - 2, nextBoundaryIndex).equals(
      Buffer.from('\r\n'),
    )
      ? nextBoundaryIndex - 2
      : nextBoundaryIndex;
    const partBuffer = rawBody.subarray(partStart, partEnd);
    const separatorIndex = partBuffer.indexOf(headerSeparatorBuffer);

    if (separatorIndex < 0) {
      cursor = nextBoundaryIndex;
      continue;
    }

    const headerText = partBuffer.subarray(0, separatorIndex).toString('utf8');
    const bodyBuffer = partBuffer.subarray(separatorIndex + headerSeparatorBuffer.length);
    const headers = headerText.split('\r\n');
    const contentDisposition = headers.find((header) =>
      header.toLowerCase().startsWith('content-disposition:'),
    );

    if (!contentDisposition) {
      cursor = nextBoundaryIndex;
      continue;
    }

    const { fieldName, fileName } = parseContentDisposition(contentDisposition);
    const contentTypeHeader = headers.find((header) =>
      header.toLowerCase().startsWith('content-type:'),
    );
    const mimeType = contentTypeHeader?.split(':')[1]?.trim() ?? 'application/octet-stream';

    if (fileName && fileName.trim().length > 0) {
      files.push({
        buffer: bodyBuffer,
        fileName: fileName.trim(),
        fieldName,
        mimeType,
        size: bodyBuffer.length,
      });
      cursor = nextBoundaryIndex;
      continue;
    }

    fields[fieldName] = bodyBuffer.toString('utf8');
    cursor = nextBoundaryIndex;
  }

  return { fields, files };
};

const getOrigin = (req: Request): string => {
  return `${req.protocol}://${req.get('host')}`;
};

const getFileExtension = (fileName: string, mimeType: string): string => {
  const extension = path.extname(fileName);

  if (extension) {
    return extension;
  }

  return MIME_TYPE_TO_EXTENSION[mimeType] ?? '';
};

export const storeMediaFiles = async (
  req: Request,
  files: ParsedMultipartFile[],
): Promise<MessageMedia[]> => {
  if (files.length === 0) {
    throw createHttpError(400, 'At least one media file is required');
  }

  await fs.mkdir(UPLOADS_DIRECTORY, { recursive: true });

  const origin = getOrigin(req);
  const storedMedia: MessageMedia[] = [];

  for (const file of files) {
    const normalizedMimeType = file.mimeType.toLowerCase();
    const mediaType = MIME_TYPE_TO_MEDIA_TYPE[normalizedMimeType];

    if (!mediaType) {
      throw createHttpError(400, `Unsupported file type: ${file.mimeType}`);
    }

    if (file.size > MAX_MEDIA_FILE_SIZE_BYTES) {
      throw createHttpError(413, 'Media file is too large. Maximum size is 25MB.');
    }

    const storedFileName = `${createId('media')}${getFileExtension(file.fileName, normalizedMimeType)}`;
    await fs.writeFile(path.join(UPLOADS_DIRECTORY, storedFileName), file.buffer);

    storedMedia.push({
      type: mediaType,
      url: `${origin}/media/${storedFileName}`,
    });
  }

  return storedMedia;
};
