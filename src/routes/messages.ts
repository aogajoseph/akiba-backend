import { Request, Router } from 'express';

import {
  ApiResponse,
  CreateMessageRequestDto,
  CreateMessageResponseDto,
  DeleteMessageResponseDto,
  ListMessagesResponseDto,
  ToggleMessageReactionRequestDto,
  ToggleMessageReactionResponseDto,
  UploadMediaMessageResponseDto,
  User,
} from '../../../shared/contracts';
import {
  ensureNonEmptyString,
  ensureOptionalNonEmptyString,
  getObjectBody,
  createHttpError,
} from '../utils/http';
import { getCurrentUserOrThrow } from '../utils/auth';
import { parseMultipartFormData, storeMediaFiles } from '../utils/media';
import {
  createMessage,
  deleteMessage,
  listMessages,
  toggleMessageReaction,
} from '../services/chatService';

const router = Router({ mergeParams: true });

type GroupParams = {
  groupId?: string;
  spaceId?: string;
};

type MessageParams = {
  groupId?: string;
  spaceId?: string;
  messageId: string;
};

const getCurrentUser = async (headerValue: string | undefined): Promise<User> => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  return getCurrentUserOrThrow(userId);
};

const getSpaceId = (params: Record<string, string | undefined>): string => {
  return ensureNonEmptyString(params.spaceId ?? params.groupId, 'spaceId is required');
};

const ensureOptionalHttpUrlString = (value: string | undefined, fieldName: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw createHttpError(400, `${fieldName} must be a valid URL`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw createHttpError(400, `${fieldName} must be an http or https URL`);
  }

  return parsedUrl.toString();
};

const inferMediaTypeFromUrl = (mediaUrl: string): 'image' | 'video' => {
  const normalizedUrl = mediaUrl.toLowerCase();

  if (
    normalizedUrl.includes('.mp4') ||
    normalizedUrl.includes('.mov') ||
    normalizedUrl.includes('.webm') ||
    normalizedUrl.includes('/video/upload/')
  ) {
    return 'video';
  }

  return 'image';
};

router.get('/', async (req: Request<GroupParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = await getCurrentUser(req.header('x-user-id'));
    const rawSince =
      typeof req.query.since === 'string' ? req.query.since.trim() : undefined;
    let since: Date | undefined;

    if (rawSince) {
      since = new Date(rawSince);

      if (Number.isNaN(since.getTime())) {
        throw createHttpError(400, 'since must be a valid ISO date string');
      }
    }

    const response: ApiResponse<ListMessagesResponseDto> = {
      data: {
        messages: await listMessages(spaceId, user.id, { since }),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: Request<GroupParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = await getCurrentUser(req.header('x-user-id'));
    const body = getObjectBody(req.body);
    const dto: CreateMessageRequestDto = {
      text: ensureNonEmptyString(body.text, 'text is required'),
      replyToMessageId: ensureOptionalNonEmptyString(
        body.replyToMessageId,
        'replyToMessageId must be a non-empty string',
      ),
    };

    const response: ApiResponse<CreateMessageResponseDto> = {
      data: {
        message: await createMessage({
          spaceId,
          userId: user.id,
          text: dto.text,
          replyToMessageId: dto.replyToMessageId,
        }),
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/media', async (req: Request<GroupParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = await getCurrentUser(req.header('x-user-id'));

    const { fields, files } = await parseMultipartFormData(req);
    const text = ensureOptionalNonEmptyString(fields.text, 'text must be a non-empty string');
    const replyToMessageId = ensureOptionalNonEmptyString(
      fields.replyToMessageId,
      'replyToMessageId must be a non-empty string',
    );
    const mediaUrl = ensureOptionalHttpUrlString(
      ensureOptionalNonEmptyString(fields.mediaUrl, 'mediaUrl must be a non-empty string'),
      'mediaUrl',
    );
    const mediaTypeField = ensureOptionalNonEmptyString(
      fields.mediaType,
      'mediaType must be a non-empty string',
    );
    const uploadedFiles = files.filter((file) => file.fieldName === 'file');
    const media =
      uploadedFiles.length > 0
        ? await storeMediaFiles(req, uploadedFiles)
        : mediaUrl
          ? [
              {
                type:
                  mediaTypeField === 'image' || mediaTypeField === 'video'
                    ? mediaTypeField
                    : inferMediaTypeFromUrl(mediaUrl),
                url: mediaUrl,
              },
            ]
          : (() => {
              throw createHttpError(400, 'At least one media file or mediaUrl is required');
            })();

    const response: ApiResponse<UploadMediaMessageResponseDto> = {
      data: {
        message: await createMessage({
          spaceId,
          userId: user.id,
          text,
          replyToMessageId,
          media,
        }),
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/:messageId/reactions', async (req: Request<MessageParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const { messageId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));

    const body = getObjectBody(req.body);
    const dto: ToggleMessageReactionRequestDto = {
      emoji: ensureNonEmptyString(body.emoji, 'emoji is required'),
    };

    const response: ApiResponse<ToggleMessageReactionResponseDto> = {
      data: {
        message: await toggleMessageReaction({
          spaceId,
          messageId,
          userId: user.id,
          emoji: dto.emoji,
        }),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.delete('/:messageId', async (req: Request<MessageParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const { messageId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    await deleteMessage({
      spaceId,
      messageId,
      userId: user.id,
    });

    const response: ApiResponse<DeleteMessageResponseDto> = {
      data: {
        success: true,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
