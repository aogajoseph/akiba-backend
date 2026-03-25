"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeMediaFiles = exports.parseMultipartFormData = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const http_1 = require("./http");
const MAX_MEDIA_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const UPLOADS_DIRECTORY = path_1.default.join(process.cwd(), 'uploads');
const MIME_TYPE_TO_MEDIA_TYPE = {
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
const MIME_TYPE_TO_EXTENSION = {
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
const getBoundary = (contentTypeHeader) => {
    if (!contentTypeHeader?.includes('multipart/form-data')) {
        throw (0, http_1.createHttpError)(400, 'Content-Type must be multipart/form-data');
    }
    const match = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = match?.[1] ?? match?.[2];
    if (!boundary) {
        throw (0, http_1.createHttpError)(400, 'Multipart boundary is missing');
    }
    return boundary;
};
const parseContentDisposition = (headerValue) => {
    const fieldMatch = headerValue.match(/name="([^"]+)"/i);
    const fileMatch = headerValue.match(/filename="([^"]*)"/i);
    if (!fieldMatch) {
        throw (0, http_1.createHttpError)(400, 'Multipart field name is missing');
    }
    return {
        fieldName: fieldMatch[1],
        fileName: fileMatch?.[1],
    };
};
const parseMultipartFormData = async (req) => {
    const boundary = getBoundary(req.header('content-type'));
    const chunks = [];
    await new Promise((resolve, reject) => {
        req.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on('end', () => resolve());
        req.on('error', reject);
    });
    const rawBody = Buffer.concat(chunks);
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const headerSeparatorBuffer = Buffer.from('\r\n\r\n');
    const fields = {};
    const files = [];
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
        const partEnd = rawBody.subarray(nextBoundaryIndex - 2, nextBoundaryIndex).equals(Buffer.from('\r\n'))
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
        const contentDisposition = headers.find((header) => header.toLowerCase().startsWith('content-disposition:'));
        if (!contentDisposition) {
            cursor = nextBoundaryIndex;
            continue;
        }
        const { fieldName, fileName } = parseContentDisposition(contentDisposition);
        const contentTypeHeader = headers.find((header) => header.toLowerCase().startsWith('content-type:'));
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
exports.parseMultipartFormData = parseMultipartFormData;
const getOrigin = (req) => {
    return `${req.protocol}://${req.get('host')}`;
};
const getFileExtension = (fileName, mimeType) => {
    const extension = path_1.default.extname(fileName);
    if (extension) {
        return extension;
    }
    return MIME_TYPE_TO_EXTENSION[mimeType] ?? '';
};
const storeMediaFiles = async (req, files) => {
    if (files.length === 0) {
        throw (0, http_1.createHttpError)(400, 'At least one media file is required');
    }
    await promises_1.default.mkdir(UPLOADS_DIRECTORY, { recursive: true });
    const origin = getOrigin(req);
    const storedMedia = [];
    for (const file of files) {
        const normalizedMimeType = file.mimeType.toLowerCase();
        const mediaType = MIME_TYPE_TO_MEDIA_TYPE[normalizedMimeType];
        if (!mediaType) {
            throw (0, http_1.createHttpError)(400, `Unsupported file type: ${file.mimeType}`);
        }
        if (file.size > MAX_MEDIA_FILE_SIZE_BYTES) {
            throw (0, http_1.createHttpError)(413, 'Media file is too large. Maximum size is 25MB.');
        }
        const storedFileName = `${(0, http_1.createId)('media')}${getFileExtension(file.fileName, normalizedMimeType)}`;
        await promises_1.default.writeFile(path_1.default.join(UPLOADS_DIRECTORY, storedFileName), file.buffer);
        storedMedia.push({
            type: mediaType,
            url: `${origin}/media/${storedFileName}`,
        });
    }
    return storedMedia;
};
exports.storeMediaFiles = storeMediaFiles;
