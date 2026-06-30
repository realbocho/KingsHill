/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireField, requireUuid, tooManyRequests, ApiError } from '@/lib/api-helpers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const POST = withApiHandler('upload', async (req: NextRequest) => {
  const form = await req.formData();

  const userId = requireUuid(form.get('userId'), 'userId');
  const file = form.get('file');
  requireField(file, 'file');

  if (!(file instanceof File)) {
    throw new ApiError('Invalid file payload', 400);
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    throw new ApiError('Unsupported image type. Use JPEG, PNG, WebP, or GIF.', 400);
  }

  if (file.size > MAX_BYTES) {
    throw new ApiError('Image too large. Max size is 5MB.', 400);
  }

  const supabase = createServiceClient() as any;

  const { data: userRow } = await supabase.from('users').select('telegram_id').eq('id', userId).single();
  if (!userRow) throw new ApiError('User not found', 404);

  const rl = await checkRateLimit({ key: `upload:${userRow.telegram_id}`, ...RATE_LIMITS.imageUpload });
  if (!rl.allowed) {
    logger.warn('upload_rate_limited', { userId, count: rl.count });
    tooManyRequests(rl.limit);
  }

  // Re-validate the actual bytes look like an image (magic-number sniff),
  // not just trusting the client-supplied MIME type, which can be spoofed.
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!looksLikeImage(buffer)) {
    throw new ApiError('File content does not match a supported image format', 400);
  }

  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('ad-images')
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    logger.error('upload_storage_error', { userId, message: uploadError.message });
    throw new ApiError('Failed to upload image', 500);
  }

  const { data: publicUrlData } = supabase.storage.from('ad-images').getPublicUrl(path);

  logger.info('image_uploaded', { userId, path, sizeBytes: file.size });

  return NextResponse.json({ path, url: publicUrlData.publicUrl });
});

/** Lightweight magic-number check for common image formats. */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  // WebP (RIFF....WEBP)
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  return false;
}
