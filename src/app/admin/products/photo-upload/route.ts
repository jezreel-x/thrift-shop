import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { MAX_PHOTO_BYTES, PHOTO_PATHNAME, PHOTO_TYPES } from "@/lib/admin/photos";

/**
 * Hands the browser a short-lived token to upload one photo to Vercel Blob.
 *
 * The file itself never passes through here. The token is narrow: one name of
 * the form products/<sha-256>.webp, images only, under 5MB, ten minutes, and no
 * overwriting — a name, once taken, keeps its content. Attaching the photo to a
 * product is a separate step that checks the content against the name.
 *
 * No onUploadCompleted: Vercel's callback cannot reach a laptop, and the
 * browser attaches the photo itself once the upload returns.
 */
export async function POST(request: Request): Promise<Response> {
  await requirePermission(Permission.PRODUCTS_EDIT);

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!PHOTO_PATHNAME.test(pathname)) throw new Error("Unexpected photo name.");

        return {
          allowedContentTypes: PHOTO_TYPES,
          maximumSizeInBytes: MAX_PHOTO_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload refused." },
      { status: 400 },
    );
  }
}
