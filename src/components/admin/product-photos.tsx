"use client";

import { upload } from "@vercel/blob/client";
import { ArrowLeft, ArrowRight, ImagePlus, Star } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState } from "react";

import {
  attachPhotoAction,
  movePhotoAction,
  removePhotoAction,
  updatePhotoAction,
} from "@/lib/admin/photo-actions";
import type { AdminPhoto } from "@/lib/admin/photos";
import { preparePhoto } from "@/lib/admin/prepare-photo";

type Swatch = { id: string; name: string; hex: string | null };

type Progress = { name: string; status: string; failed?: boolean };

const SMALL_BUTTON =
  "rounded-md border border-border px-2 py-1 text-xs transition hover:bg-surface-muted disabled:opacity-40";

/**
 * The product's photos: upload, tag by colour, order, remove.
 *
 * The first photo is the main one, on the catalogue card. A photo tagged with
 * a colour shows when a buyer picks that colour; untagged photos show for
 * every colour.
 */
export function ProductPhotos({
  productId,
  photos,
  swatches,
  colourLabel,
}: {
  productId: string;
  photos: AdminPhoto[];
  swatches: Swatch[];
  colourLabel: string;
}) {
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadSwatch, setUploadSwatch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selectId = useId();

  async function addPhotos(files: File[]) {
    setBusy(true);
    const report = (index: number, status: string, failed = false) =>
      setProgress((current) =>
        current.map((item, at) => (at === index ? { ...item, status, failed } : item)),
      );
    setProgress(files.map((file) => ({ name: file.name, status: "Waiting" })));

    // One at a time: a phone on mobile data does better with one upload than six.
    for (const [index, file] of files.entries()) {
      try {
        report(index, "Preparing…");
        const photo = await preparePhoto(file);

        report(index, "Uploading…");
        try {
          await upload(photo.pathname, photo.blob, {
            access: "public",
            handleUploadUrl: "/admin/products/photo-upload",
            contentType: photo.blob.type,
            onUploadProgress: ({ percentage }) =>
              report(index, `Uploading… ${Math.round(percentage)}%`),
          });
        } catch {
          // Most often the same photo is already in storage — names are the
          // content's hash. Attaching checks the stored file either way.
        }

        report(index, "Adding…");
        const result = await attachPhotoAction({
          productId,
          swatchId: uploadSwatch || null,
          pathname: photo.pathname,
          width: photo.width,
          height: photo.height,
        });
        report(index, result.ok ? "Added" : result.error, !result.ok);
      } catch (error) {
        report(index, error instanceof Error ? error.message : "Couldn't add this photo.", true);
      }
    }

    setBusy(false);
    if (input.current) input.current.value = "";
  }

  return (
    <section aria-labelledby="photos">
      <h2 id="photos" className="text-lg font-semibold">
        Photos
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        The first is the main photo, on the catalogue.
        {swatches.length > 0 &&
          ` Tag a photo with a ${colourLabel.toLowerCase()} and it shows when a buyer picks it; untagged photos show for every ${colourLabel.toLowerCase()}.`}
      </p>

      {photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo, index) => (
            <li
              key={photo.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
            >
              <div className="relative aspect-[4/5] bg-surface-muted">
                <Image
                  src={photo.url}
                  alt={photo.alt}
                  fill
                  sizes="(min-width: 1024px) 220px, 45vw"
                  className="object-cover"
                />
                {index === 0 && (
                  <span className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
                    Main
                  </span>
                )}
              </div>

              <form action={updatePhotoAction} className="flex flex-col gap-2 p-2">
                <input type="hidden" name="imageId" value={photo.id} />
                {swatches.length > 0 && (
                  <select
                    name="swatchId"
                    defaultValue={photo.swatchId ?? ""}
                    aria-label={`${colourLabel} this photo shows`}
                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value="">Every {colourLabel.toLowerCase()}</option>
                    {swatches.map((swatch) => (
                      <option key={swatch.id} value={swatch.id}>
                        {swatch.name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  name="alt"
                  defaultValue={photo.alt}
                  maxLength={200}
                  aria-label="Description, for people who can't see the photo"
                  placeholder="Describe the photo"
                  className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs"
                />
                <button type="submit" className={SMALL_BUTTON}>
                  Save
                </button>
              </form>

              <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border p-2">
                <MoveButton
                  photoId={photo.id}
                  move="earlier"
                  disabled={index === 0}
                  label="Earlier"
                >
                  <ArrowLeft aria-hidden className="size-3.5" />
                </MoveButton>
                <MoveButton
                  photoId={photo.id}
                  move="later"
                  disabled={index === photos.length - 1}
                  label="Later"
                >
                  <ArrowRight aria-hidden className="size-3.5" />
                </MoveButton>
                {index > 0 && (
                  <MoveButton photoId={photo.id} move="first" label="Make main">
                    <Star aria-hidden className="size-3.5" />
                  </MoveButton>
                )}
                <RemovePhoto photoId={photo.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-border p-4">
        {swatches.length > 0 && (
          <div className="flex flex-col gap-1">
            <label htmlFor={selectId} className="text-xs text-muted">
              New photos show
            </label>
            <select
              id={selectId}
              value={uploadSwatch}
              onChange={(event) => setUploadSwatch(event.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="">Every {colourLabel.toLowerCase()}</option>
              {swatches.map((swatch) => (
                <option key={swatch.id} value={swatch.id}>
                  {swatch.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <label
          className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          <ImagePlus aria-hidden className="size-4" />
          {busy ? "Adding photos…" : "Add photos"}
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length > 0) void addPhotos(files);
            }}
            className="sr-only"
          />
        </label>
        <p className="text-xs text-muted">
          Straight from your phone&apos;s camera is fine: photos are shrunk before they upload.
        </p>
      </div>

      {progress.length > 0 && (
        <ul aria-live="polite" className="mt-3 space-y-1 text-sm">
          {progress.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className={item.failed ? "text-red-700 dark:text-red-300" : "text-muted"}
            >
              <span className="font-medium">{item.name}</span>: {item.status}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MoveButton({
  photoId,
  move,
  disabled = false,
  label,
  children,
}: {
  photoId: string;
  move: "earlier" | "later" | "first";
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <form action={movePhotoAction}>
      <input type="hidden" name="imageId" value={photoId} />
      <input type="hidden" name="move" value={move} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={label}
        title={label}
        className={`${SMALL_BUTTON} inline-flex items-center gap-1`}
      >
        {children}
        {move === "first" && <span>Main</span>}
      </button>
    </form>
  );
}

/** Asks first, like the other removals in the admin; removes directly without script. */
function RemovePhoto({ photoId }: { photoId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  return (
    <>
      <form
        ref={form}
        action={removePhotoAction}
        onSubmit={(event) => {
          if (confirmed.current) {
            confirmed.current = false;
            return;
          }
          event.preventDefault();
          dialog.current?.showModal();
        }}
        className="ml-auto"
      >
        <input type="hidden" name="imageId" value={photoId} />
        <button
          type="submit"
          className="rounded-md px-2 py-1 text-xs text-red-700 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
        >
          Remove
        </button>
      </form>
      <dialog
        ref={dialog}
        aria-label="Remove this photo?"
        className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <h2 className="text-lg font-semibold">Remove this photo?</h2>
        <p className="mt-2 text-sm text-muted">
          It comes off this product. To bring it back, upload it again.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current?.close()}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              confirmed.current = true;
              dialog.current?.close();
              form.current?.requestSubmit();
            }}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            Remove
          </button>
        </div>
      </dialog>
    </>
  );
}
